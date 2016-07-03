var cmd=require('node-cmd');
var fs=require('fs');
var SerialPort = require("serialport");
var Message=require('js-message');

cmd.get(
    'echo BB-UART1 > /sys/devices/bone_capemgr.*/slots && echo BB-UART2 > /sys/devices/bone_capemgr.*/slots',
    getCalibration
);

var desiredWatts=0;

var debug=false;

Array.prototype.sum = function() {
    return this.reduce(function(a,b){return a+b;});
};

if(!debug){
    console.log=function(){}
}

const COMMAND='M,ccc,vvv,sss,E';
const STANDBY='M,001,000,001,E';

const IDLE='M,R:M';
const CHARGING='M,S:D';
const STARTED_CHARGE='M,M,';
const CHARGE_COMPLETE='M,DONE,E';
const TOTAL_CHARGED='AH,E';
const JPLUG='J:';
const MESSAGE_END=',E';

const UNKNOWN_MESSAGE='M,I:';

const MAX_CURRENT=95;
const BATTERY_VOLTAGE=116;
const BATTERY_VOLTAGE_MIN=70;

//const MAX_WATTAGE=12000;
var MAX_WATTAGE=12000;

const RAMPDOWN_WATTAGE=100;

const AUTO_START_TIMEOUT=500; //start after 0.5sec

const CHARGER_BAUD=19200;
const CHARGER_PORT='/dev/ttyO2';//'/dev/ttyUSB0';

const BT_BAUD=19200;
// LUKE or BTLE & BT combo
//const BT_PORT='/dev/ttyO4';
const BT_PORT='/dev/ttyO1';

var BATT_OFFSET=0;
var IS_JPLUG=false;

var manuallySet=false;
var forceSet=false;

var stopped=false;

var autoStart=false;

var means={
    amps:[0,0,0,0,0,0,0,0,0,0,0,0],
    volts:[0,0,0,0,0,0,0,0,0,0,0,0],
    mains:[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    blind:[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    ampMean:0,
    voltMean:0,
    mainsMean:0,
    blindMean:0
};

var chargerState={
    mainsV:0,
    estMainsV:120,
    estMaxWattage:1000,
    battV:0,
    calibratedBattV:0,
    outA:0,
    duty:0,
    temp:0,
    outAH:0,
    means:means,
    duration:0,
    jplug:{
        width:0,
        maxAmps:0
    }
};

var totalAHCharged=0;
var startTime=new Date().getTime();

var apiBT=null;
var charger=null;

var dataStorageDelay=60000;
var dataStorageInterval=null;

var untilBroadcast=8;

var storageDir = __dirname + '/uploads/';

cmd.run('find '+storageDir+' -mtime +5 -exec rm {} \\;');

function getCalibration(){
    //init();
    fs.readFile(
        '/root/calibration/battery',
        function(err, data){
            if (err){
                init();
                return;
            };
            BATT_OFFSET=Number(data);
            init();
        }
    );
}

function getMainsV(){
    var mainsV=110;

    switch(true){
        case (chargerState.mainsV>405):
            means.blind.push(10);
            break;
        case (chargerState.mainsV>380):
            mainsV=240;
            means.blind.push(39);
            break;
        case (chargerState.mainsV>350):
            mainsV=214;
            means.blind.push(35);
            break;
        case (chargerState.mainsV>340):
            mainsV=210;
            means.blind.push(32);
            break;
        case (chargerState.mainsV>290):
            mainsV=208;
            means.blind.push(30);
            break;
        case (chargerState.mainsV>270):
            mainsV=190;
            means.blind.push(28);
            break;
        case (chargerState.mainsV>250):
            mainsV=170;
            means.blind.push(25);
            break;
        case (chargerState.mainsV>230):
            mainsV=160;
            means.blind.push(22);
            break;
        case (chargerState.mainsV>220):
            mainsV=140;
            means.blind.push(20);
            break;
        case (chargerState.mainsV>200):
            mainsV=130;
            means.blind.push(18);
            break;
        default :
            means.blind.push(8);
    }

    means.blind.shift();
    means.mains.push(mainsV);
    means.mains.shift();
    means.blindMean=means.blind.sum();
    means.mainsMean=means.mains.sum();

    chargerState.estMainsV=means.mainsMean;

    MAX_WATTAGE=Math.floor(means.blindMean*means.mainsMean);

    if(IS_JPLUG){
        MAX_WATTAGE=Math.floor(chargerState.jplug.maxAmps*means.mainsMean);
    }

    if(forceSet){
        MAX_WATTAGE=12000;
    }

    chargerState.estMaxWattage=MAX_WATTAGE;

    return mainsV;
}

function calibrate(offset){
    console.log('-------------------');
    console.log(offset);
    console.log('-------------------');

    if(isNaN(offset)){
        return;
    }

    BATT_OFFSET=BATT_OFFSET+offset;

    console.log('-------------------');
    console.log(BATT_OFFSET);
    console.log('-------------------');


    fs.writeFile(
        '/root/calibration/battery',
        BATT_OFFSET
    );

    var message=formatMessage(
        desiredWatts/means.voltMean
    );

    if(!message){
        return;
    }

    sendData(
        charger,
        message
    );
}

function init(){
    apiBT = new SerialPort.SerialPort(
        BT_PORT,
        {
            baudrate: BT_BAUD,
            parser: SerialPort.parsers.readline('\n')
        }
    );

    charger = new SerialPort.SerialPort(
        CHARGER_PORT,
        {
            baudrate: CHARGER_BAUD,
            parser: SerialPort.parsers.readline('\n')
        }
    );

    apiBT.on(
        'open',
        startAPIBT
    );

    charger.on(
        'open',
        start
    );
}

function startAPIBT() {
    console.log('open ',BT_PORT);

    apiBT.on(
        'data',
        handleRemoteCommand
    );

    try{
        broadcast();
    }catch(err){}
}

function start(){
    console.log('open ',CHARGER_PORT);
    charger.on(
        'data',
        gotData
    );

    dataStorageInterval=setInterval(
        storeData,
        dataStorageDelay
    );

    storeData();
}

setInterval(
    storeData,
    dataStorageDelay
);

function storeData(){
    fs.appendFile(
        storageDir+startTime,
        JSON.stringify(chargerState)+'|-|',
        'utf8',
        function(){}
    );
}

function gotData(data){
    console.log('got data',data);

    data=data.replace(/[\r\n]/ig,'');
    var isInvalid=data.match(/[^a-z0-9,:]/ig,'')
        ||(
            data.indexOf(MESSAGE_END)<0
            &&data.indexOf(JPLUG)<0
        );

    if(isInvalid){
        //definately invalid
        return;
    }

    if(data.indexOf(CHARGING)==0){
        parseCharging(data);
    }

    if(data.indexOf(IDLE)==0){
        parseIdle(data);
    }

    if(data.indexOf(STARTED_CHARGE)==0){
        startTime=new Date().getTime();
        chargeStarted(data);
    }

    if(data.indexOf(CHARGE_COMPLETE)==0){
        chargeComplete();
    }

    if(data.indexOf(TOTAL_CHARGED)>0){
        parseTotalCharge(data);
    }

    if(data.indexOf(JPLUG)==0){
        parseJPLUG(data);
    }

    if(data.indexOf(UNKNOWN_MESSAGE)==0){
        console.log('??? : ',data);
    }

    //console.log('charger state',chargerState);

    untilBroadcast--;
    if(untilBroadcast>0){
        return;
    }
    untilBroadcast=8;
    broadcast();
}

/**
 * [sendData description]
 * @param  {SerialPort} interface serialport to send data to
 * @param  {String} message to send
 * @return {void}
 */
function sendData(interface,message){
    interface.write(message+'\n');
}

/**
 * [broadcast description]
 * @param  {Message} message
 * @return {void}
 */
function broadcast(message) {
    if(!message){
        message=new Message;
        message.type='chargerState';
        message.data=chargerState;
    }

    //console.log(chargerState);

    //console.log('broadcast ',message.JSON);

    try{
        sendData(apiBT,message.JSON);
    }catch(err){

    }

};

function turnOff(){
    chargerState.duty   = 0;
    chargerState.outA   = 0;
    desiredWatts=0;
    sendData(charger,STANDBY);
}

function formatMessage(current){
    clearTimeout(autoStart);
    console.log('-',current);
    var min='000';
    current=Number(current)||10;
    if(current>means.blindMean && !forceSet){
        current=means.blindMean;
    }
    current=Math.round(current);

    var voltage=BATTERY_VOLTAGE-BATT_OFFSET;

    var signature=(current+voltage)%1000;

    if(
        voltage===Infinity
        || isNaN(voltage)
        || current===Infinity
        || isNaN(current)
        || signature===Infinity
        || isNaN(signature)
    ){
        console.log(voltage,current,signature);
        return;
    }

    voltage=min+voltage;
    current=min+current;
    signature=min+signature;

    current=current.slice(-3);
    voltage=voltage.slice(-3);
    signature=signature.slice(-3);

    console.log('start request',current,voltage,signature);

    var message=COMMAND.replace('ccc',current)
        .replace('vvv',voltage)
        .replace('sss',signature);

    console.log(message);

    if(message.length!==COMMAND.length){
        return;
    }

    return message;
}

function parseJPLUG(data){
    console.log('JPLUG DATA : ',data);
    chargerState.jplug.raw=data;
    data=data.slice(
        data.indexOf(JPLUG)+JPLUG.length,
        data.indexOf('A')
    ).replace(/[^0-9,]/ig,'').split(',');
    chargerState.jplug.raw+='|'+data;

    chargerState.jplug.maxAmps=Number(data[1]);
    chargerState.jplug.width=Number(data[0]);

    if(isNaN(chargerState.jplug.maxAmps)||isNaN(chargerState.jplug.width)){
        chargerState.jplug.maxAmps=10;
        chargerState.jplug.width=0;
    }

    if(chargerState.jplug.maxAmps<10){
        chargerState.jplug.maxAmps=10;
    }

    calcJPlugMax();

    if(!IS_JPLUG){
        IS_JPLUG=true;
        desiredWatts=MAX_WATTAGE;
    }
}

function calcJPlugMax(){
    var mainsV=getMainsV();
    MAX_WATTAGE=Math.floor(chargerState.jplug.maxAmps*mainsV);
    chargerState.estMaxWattage  = MAX_WATTAGE;

    if(MAX_WATTAGE<desiredWatts){
        desiredWatts=MAX_WATTAGE;
    }
}

var rampingDown=false;

function parseCharging(data){
    clearTimeout(autoStart);
    if(stopped){
        turnOff();
        return;
    }
    data=data.slice(
        data.indexOf(CHARGING)+CHARGING.length,
        data.indexOf(MESSAGE_END)
    ).replace(/[^0-9,]/ig,'').split(',');
    chargerState.duty   = Number(data[0])/100;
    chargerState.outA   = Number(data[1])/10;
    chargerState.battV   = Number(data[2]);
    chargerState.calibratedBattV  = Number(data[2])+BATT_OFFSET;
    chargerState.temp   = Number(data[3]);
    chargerState.outAH  = Number(data[4]);
    chargerState.mainsV  = Number(data[5]);

    chargerState.duration=(
        (new Date().getTime()-startTime)
        /1000/60/60
    ).toFixed(2);

    means.amps.push(chargerState.outA);
    means.amps.shift();

    means.volts.push(chargerState.calibratedBattV);
    means.volts.shift();

    means.ampMean=(means.amps.sum() / means.amps.length).toFixed(1);
    means.voltMean=(means.volts.sum() / means.volts.length).toFixed(1);

    getMainsV();

    if(IS_JPLUG){
        calcJPlugMax();
    }

    var requiresUpdate=false;

    if(desiredWatts<1){
        turnOff();
        return;
    }

    if(desiredWatts>MAX_WATTAGE){
        desiredWatts=MAX_WATTAGE;
        requiresUpdate=true;
    }

    if(
        means.voltMean >= BATTERY_VOLTAGE
    ){
        rampingDown=true;
        desiredWatts-=RAMPDOWN_WATTAGE;
        requiresUpdate=true;
        if(desiredWatts<1){
            turnOff();
            return;
        }
    }

    if(!manuallySet&&!rampingDown){
        desiredWatts=MAX_WATTAGE;
        requiresUpdate=true;
    }

    if(
        means.ampMean*means.voltMean > desiredWatts+200
        || means.ampMean*means.voltMean < desiredWatts-300
    ){
        requiresUpdate=true;
    }

    if(requiresUpdate){
        var message=formatMessage(
            desiredWatts/means.voltMean
        );

        if(!message){
            return;
        }

        sendData(
            charger,
            message
        );
    }
}

function parseIdle(data){
    data=data.slice(
        data.indexOf(IDLE)+IDLE.length,
        data.indexOf(MESSAGE_END)
    ).replace(/[^0-9,]/ig,'').split(',');
    chargerState.mainsV= Number(data[0]);
    chargerState.battV = Number(data[1]);
    chargerState.calibratedBattV=Number(data[1])+BATT_OFFSET
    chargerState.outA = Number(data[2]);
    chargerState.temp = Number(data[4]);

    means.amps.push(0);
    means.amps.shift();

    means.volts.push(chargerState.calibratedBattV);
    means.volts.shift();

    means.ampMean=(means.amps.sum() / means.amps.length).toFixed(1);
    means.voltMean=(means.volts.sum() / means.volts.length).toFixed(1);

    if(means.voltMean<BATTERY_VOLTAGE_MIN){
        means.voltMean=BATTERY_VOLTAGE-2;
    }

    console.log(
        chargerState.calibratedBattV
    );

    getMainsV();

    if(
        chargerState.calibratedBattV<BATTERY_VOLTAGE
        && chargerState.calibratedBattV>BATTERY_VOLTAGE_MIN
    ){
        var amps=0;
        desiredWatts=MAX_WATTAGE;

        if(IS_JPLUG){
            calcJPlugMax();
            desiredWatts=MAX_WATTAGE;
        }

        amps=Math.round(
            (desiredWatts/means.voltMean)
            /2
        );

        var message=formatMessage(amps);

        if(!message){
            return;
        }

        sendData(
            charger,
            message
        );

        return;
    }

    desiredWatts=0;
}

function parseTotalCharge(data){
    data=data.replace(/[^0-9]/,'');
    totalAHCharged=Number(data);
    //do nothing
}

function chargeStarted(data){
    clearTimeout(autoStart);
    data=data.slice(
        data.indexOf(STARTED_CHARGE)+STARTED_CHARGE.length,
        data.indexOf(MESSAGE_END)
    ).replace(/[^0-9,]/ig,'').split(',');

    getMainsV();
    //DO SOMETHING?
}

function chargeComplete(){
    desiredWatts=0;
    stopped=true;
    turnOff();
}

function handleRemoteCommand(data){
    console.log(data);
    message=new Message;
    message.load(data);

    console.log('\n\n\n---\n\n\ncommand data',message.JSON);

    switch(message.type){
        case 'forceOut' :
            forceSet=true;
        case 'setOut' :
            //console.log(message.type,message.data);
            stopped=false;
            desiredWatts=Math.abs(
                Number(message.data.W)
            );

            if(isNaN(desiredWatts)){
                //@TODO throw to client
                desiredWatts=500;
            }

            getMainsV();

            manuallySet=true;

            if(desiredWatts>MAX_WATTAGE){
                desiredWatts=MAX_WATTAGE;
            }

            amps=Math.round(
                desiredWatts
            );

            var message=formatMessage(amps);

            if(!message){
                return;
            }

            sendData(
                charger,
                message
            );

            break;
        case 'calibrate' :
            calibrate(
                (Number(message.data.offset)||0)
            );
            break;
        case 'stopCharging' :
            stopped=true;
            turnOff();
            //allow fall through
        case 'autoAdjust' :
            forceSet=false;
            manuallySet=false;
            break;
        case 'connect' :
            broadcast();
            break;
    }
}
