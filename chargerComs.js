const cmd=require('node-cmd');
const fs=require('fs');
const SerialPort = require("serialport");
const Message=require('js-message');
const WebSocketServer = require('ws').Server;
const server = new WebSocketServer({ port: 81 });

// cmd.get(
//     'echo BB-UART1 > /sys/devices/bone_capemgr.*/slots && echo BB-UART2 > /sys/devices/bone_capemgr.*/slots',
//     getCalibration
// );

getCalibration();

//cmd.run('/etc/init.d/hostapd restart&&/etc/init.d/isc-dhcp-server restart')log;
//cmd.run('/sbin/ifdown eth0');

let desiredWatts=0;
let preChargeTest=20;
let preCharging=true;
let startPreChargeVoltage=0;

const debug=false;

Array.prototype.sum = function() {
    return this.reduce(function(a,b){return a+b;});
};

Array.prototype.mean = function() {
    return this.sum()/this.length;
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
const BATTERY_VOLTAGE_MIN=79;
const BATTERY_VOLTAGE_MAX=118;
const MIN_CURRENT=5;

//const MAX_WATTAGE=12000;
let MAX_WATTAGE=12000;
const BAD_CHARGER=5100;

const RAMP_WATTAGE=50;

const AUTO_START_TIMEOUT=500; //start after 0.5sec

const CHARGER_BAUD=19200;
const CHARGER_PORT='/dev/ttyS2';//'/dev/ttyUSB0';

const BT_BAUD=19200;
// LUKE or BTLE & BT combo
//const BT_PORT='/dev/ttyO4';
const BT_PORT='/dev/ttyS1';

let BATT_OFFSET=0;
let IS_JPLUG=false;
let DEFAULT_POWER=1300;

let forceSet=false;

let stopped=false;

const autoStart=false;

const BUFFER=[0,0,0,0,0,0,0,0,0,0,0,0];

const means={
    amps:[0,0,0,0,0,0,0,0,0,0,0,0],
    volts:[0,0,0,0,0,0,0,0,0,0,0,0],
    mains:[100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100],
    blind:[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    ampMean:0,
    voltMean:0,
    mainsMean:0,
    blindMean:0
};

const chargerState={
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

let totalAHCharged=0;
let startTime=new Date().getTime();

let apiBT=null;
let charger=null;

const dataStorageDelay=60000;
let dataStorageInterval=null;

let untilBroadcast=4;

let rampingDown=false;
let rampingUp=true;

const storageDir = __dirname + '/uploads/';

cmd.run('find '+storageDir+' -mtime +5 -exec rm {} \\;');

server.on(
  'connection',
  function connection(ws) {
    ws.on(
      'message',
      handleRemoteCommand
    );

    broadcast();
  }
);

server.broadcast = function broadcast(data) {
  server.clients.forEach(
    function each(client) {
      client.send(data);
    }
  );
};

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
    //
    // switch(true){
    //     case (chargerState.mainsV>430):
    //         means.blind.push(10);
    //         break;
    //     case (chargerState.mainsV>408):
    //         means.blind.push(15);
    //         break;
    //     case (chargerState.mainsV>385):
    //         mainsV=240;
    //         means.blind.push(40);
    //         break;
    //     case (chargerState.mainsV>350):
    //         mainsV=214;
    //         means.blind.push(35);
    //         break;
    //     case (chargerState.mainsV>290):
    //         mainsV=208;
    //         means.blind.push(30);
    //         break;
    //     case (chargerState.mainsV>200):
    //         mainsV=190;
    //         means.blind.push(25);
    //         break;
    //     case (chargerState.mainsV>160):
    //         mainsV=160;
    //         means.blind.push(22);
    //         break;
    //     default :
    //         means.blind.push(8);
    // }

    mainsV=208;
    means.blind.push(32);

    means.blind.shift();
    means.mains.push(mainsV);
    means.mains.shift();
    means.blindMean=Math.floor(means.blind.mean());
    means.mainsMean=Math.round(means.mains.mean());

    chargerState.estMainsV=means.mainsMean;

    //MAX_WATTAGE=Math.floor(means.blindMean*means.mainsMean);

    MAX_WATTAGE=DEFAULT_POWER;

    if(IS_JPLUG){
        MAX_WATTAGE=Math.floor(chargerState.jplug.maxAmps*means.mainsMean);
    }

    if(forceSet){
        MAX_WATTAGE=12000;
    }

    chargerState.estMaxWattage=MAX_WATTAGE;

    return mainsV;
}

function calibrateDefaultPower(power){
    console.log('-------------------');
    console.log(power);
    console.log('-------------------');

    if(isNaN(power)){
        console.log('rejected')
        return;
    }

    if(power < 500){
        power=500;
    }

    desiredWatts=power;

    MAX_WATTAGE=power;
    DEFAULT_POWER=power;

    fs.writeFile(
        '/root/calibration/power',
        power
    );
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
    console.log('connecting to BT',BT_PORT,BT_BAUD);
    apiBT = new SerialPort(
        BT_PORT,
        {
            baudrate: BT_BAUD,
            parser: SerialPort.parsers.readline('\n')
        }
    );
    console.log('connecting to charger',CHARGER_PORT,CHARGER_BAUD);
    charger = new SerialPort(
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
    }catch(err){

    }
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

    fs.readFile(
        '/root/calibration/power',
        function(err, data){
            if (err){
                //fine
                return;
            }

            data=Number(data);

            if(isNaN(data)){
                data=DEFAULT_POWER;
            }

            if(data < 500){
                data=BAD_CHARGER;
            }


            DEFAULT_POWER=data;
            MAX_WATTAGE=data;

            var message=new Message;
            message.type='setOut';
            message.data={
                W:data
            };

            console.log(data,MAX_WATTAGE,DEFAULT_POWER);

            setTimeout(
                handleRemoteCommand.bind(null,message.JSON),
                200
            );

            setTimeout(
                handleRemoteCommand.bind(null,message.JSON),
                1000
            );
        }
    );
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
    untilBroadcast=4;
    broadcast();
}

/**
 * [sendData description]
 * @param  {SerialPort} interface serialport to send data to
 * @param  {String} message to send
 * @return {void}
 */
function sendData(interface,message){
    console.log('sending',message)
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

    try{
      server.broadcast(message.JSON);
    }catch(err){

    }

};

function turnOff(){
    chargerState.duty   = 0;
    chargerState.outA   = 0;
    desiredWatts=0;
    stopped=true;
    rampingDown=false;
    rampingup=false;
    forceSet=false;
    preChargeTest=20;
    startPreChargeVoltage=0;

    for(var i=0; i<means.amps.length; i++){
        means.amps[i]=chargerState.outA;
    }
    for(var i=0; i<means.volts.length; i++){
        means.volts[i]=0;
    }
    sendData(charger,STANDBY);
    broadcast();

    setTimeout(
        broadcast,
        1000
    );
}

function formatMessage(current){
    clearTimeout(autoStart);
    console.log('-',current);
    var min='000';
    current=Number(current)||MIN_CURRENT;

    if(isNaN(current) || current==Infinity){
        current=MIN_CURRENT;
    }

    if(current>MAX_CURRENT){
      current=MAX_CURRENT
    }

    // if(current>means.blindMean && !forceSet){
    //     current=means.blindMean;
    // }

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
        console.log('invalid request', voltage,current,signature);
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

    if(
      chargerState.calibratedBattV>BATTERY_VOLTAGE_MAX
    ){
      storeData();
      turnOff();
      return;
    }

    chargerState.duration=(
        (new Date().getTime()-startTime)
        /1000/60/60
    ).toFixed(2);

    // if(means.amps.sum()<200){
    //     for(var i=0; i<means.amps.length; i++){
    //         means.amps[i]=chargerState.outA;
    //     }
    // }

    means.amps.push(chargerState.outA);
    means.amps.shift();

    means.volts.push(chargerState.calibratedBattV);
    means.volts.shift();

    means.ampMean=(means.amps.mean()).toFixed(1);
    means.voltMean=(means.volts.mean()).toFixed(1);

    getMainsV();

    if(IS_JPLUG){
        calcJPlugMax();
    }

    var requiresUpdate=false;

    if(chargerState.outA>MAX_CURRENT + 20){
        desiredWatts-=RAMP_WATTAGE*10;
        requiresUpdate=true;
    }

    if(desiredWatts<1){
        turnOff();
        return;
    }

    if(means.ampMean*means.voltMean>=MAX_WATTAGE){
        rampingUp=false;
        requiresUpdate=true;
        desiredWatts=MAX_WATTAGE;
    }

    if(desiredWatts>MAX_WATTAGE){
        desiredWatts=MAX_WATTAGE;
        requiresUpdate=true;
    }

    if(!rampingDown&&rampingUp){
        let nextWattage=(means.ampMean*means.voltMean)+RAMP_WATTAGE*20;
        if(nextWattage<BATTERY_VOLTAGE*MIN_CURRENT){
          nextWattage=BATTERY_VOLTAGE*MIN_CURRENT;
        }
        if(nextWattage>MAX_WATTAGE){
          nextWattage=MAX_WATTAGE;
        }
        if(nextWattage<desiredWatts){
          var message=formatMessage(
              nextWattage/means.voltMean
          );

          if(!message){
              return;
          }

          sendData(
              charger,
              message
          );
        }else{
          rampingUp=false;
          requiresUpdate=true;
        };
    }

    if(
        means.voltMean >= BATTERY_VOLTAGE
    ){
        rampingDown=true;
        rampingUp=false;
        desiredWatts-=RAMP_WATTAGE;
        requiresUpdate=true;
        if(desiredWatts<1){
            turnOff();
            return;
        }
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

    // if(chargerState.outA<10){
    //     means.amps=BUFFER;
    // }

    means.volts.push(chargerState.calibratedBattV);
    means.volts.shift();

    means.ampMean=(means.amps.mean()).toFixed(1);
    means.voltMean=(means.volts.mean()).toFixed(1);

    if(
        chargerState.calibratedBattV<BATTERY_VOLTAGE_MIN
        || chargerState.calibratedBattV>BATTERY_VOLTAGE_MAX
    ){
        return;
    }

    if(preChargeTest){
        if(preChargeTest>19){
            startPreChargeVoltage=chargerState.calibratedBattV;
        }

        preChargeTest--;
    }

    if(startPreChargeVoltage>chargerState.calibratedBattV){
        stopped=true;
        turnOff();
        return;
    }


    console.log(
        chargerState
    );

    getMainsV();

    if(
        chargerState.calibratedBattV<BATTERY_VOLTAGE
        && chargerState.calibratedBattV>BATTERY_VOLTAGE_MIN
        && !stopped
    ){
        var amps=0;
        rampingUp=true;
        if(!desiredWatts){
            desiredWatts=MAX_WATTAGE;
        }

        if(IS_JPLUG){
            calcJPlugMax();
            desiredWatts=MAX_WATTAGE;
        }

        amps=MIN_CURRENT;

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
    rampingDown=false;
    rampingup=false;
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
            MAX_WATTAGE=12000;
        case 'setOut' :
            //console.log(message.type,message.data);
            stopped=false;
            rampingDown=false;
            rampingUp=true;
            desiredWatts=Math.abs(
                Number(message.data.W)
            );

            if(isNaN(desiredWatts)){
                //@TODO throw to client
                desiredWatts=BATTERY_VOLTAGE*MIN_CURRENT;
            }

            getMainsV();

            if(desiredWatts>MAX_WATTAGE){
                desiredWatts=MAX_WATTAGE;
            }

            amps=MIN_CURRENT;

            console.log('requested ',desiredWatts,' watts starting at  ',amps,' amps');

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
        case 'defaultPower' :
            calibrateDefaultPower(
                (Number(message.data.offset)||0)
            );
            break;
        case 'stopCharging' :
            stopped=true;
            turnOff();
            //allow fall through
        case 'autoAdjust' :
            forceSet=false;
            break;
        case 'connect' :
            broadcast();
            break;
    }
}
