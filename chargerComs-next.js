'use strict';

cmd.get(
    'echo BB-UART1 > /sys/devices/bone_capemgr.*/slots && echo BB-UART2 > /sys/devices/bone_capemgr.*/slots',
    getCalibration
);

var debug=false;

if(!debug){
    console.log=function(){}
}



const CHARGER_BAUD=19200;
const CHARGER_PORT='/dev/ttyO2';//'/dev/ttyUSB0';

const BT_BAUD=19200;
// LUKE
//const BT_PORT='/dev/ttyO4';
const BT_PORT='/dev/ttyO1';

var apiBT=null;
var charger=null;

var dataStorageDelay=15000;
var dataStorageInterval=null;

var untilBroadcast=8;

var storageDir = __dirname + '/uploads';

// fs.readdir(uploadsDir, function(err, files) {
//   files.forEach(function(file, index) {
//     fs.stat(path.join(uploadsDir, file), function(err, stat) {
//       var endTime, now;
//       if (err) {
//         return console.error(err);
//       }
//       now = new Date().getTime();
//       endTime = new Date(stat.ctime).getTime() + 3600000;
//       if (now > endTime) {
//         return rimraf(path.join(uploadsDir, file), function(err) {
//           if (err) {
//             return console.error(err);
//           }
//           console.log('successfully deleted');
//         });
//       }
//     });
//   });
// });

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


    sendData(
        charger,
        formatMessage(
            desiredWatts/chargerState.calibratedBattV
        )
    );
    fs.writeFile(
        '/root/calibration/battery',
        BATT_OFFSET
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
    chargerState.temp   = 0;
    desiredWatts=0;
    sendData(charger,STANDBY);
}

function formatMessage(current){
    clearTimeout(autoStart);
    console.log('-',current);
    var min='000';
    current=Number(current)||10;
    current=Math.round(current);

    var voltage=BATTERY_VOLTAGE-BATT_OFFSET;

    if(
        voltage===Infinity
        || isNaN(voltage)
        || current===Infinity
        || isNaN(current)
    ){
        console.log(voltage,current);
        return;
    }

    var signature=(current+voltage)%1000;

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

    return message;
}

function parseJPLUG(data){
    console.log('JPLUG DATA : ',data);
    data=data.replace(JPLUG,'').replace('A  \r','').split(',');
    chargerState.jplug.maxAmps=Number(data[1]);
    chargerState.jplug.width=Number(data[0]);
    MAX_WATTAGE=chargerState.jplug.maxAmps*chargerState.mainsV;

    if(MAX_WATTAGE<desiredWatts){
        desiredWatts=MAX_WATTAGE;
    }

    if(!IS_JPLUG){
        IS_JPLUG=true;
        desiredWatts=MAX_WATTAGE;
    }
}

function parseCharging(data){
    clearTimeout(autoStart);
    if(stopped){
        turnOff();
        return;
    }
    data=data.slice(CHARGING.length,data.length-3).replace(/[A-Z]/ig,'').split(',');
    chargerState.duty   = Number(data[0])/100;
    chargerState.outA   = Number(data[1])/10;
    chargerState.battV   = Number(data[2]);
    chargerState.calibratedBattV  = Number(data[2])+BATT_OFFSET;
    chargerState.temp   = Number(data[3]);
    chargerState.outAH  = Number(data[4]);

    chargerState.duration=Math.round(
        (new Date().getTime()-startTime)  /1000/60
    );

    means.amps.push(chargerState.outA);
    means.amps.shift();

    means.volts.push(chargerState.calibratedBattV);
    means.volts.shift();

    means.ampMean=(means.amps.sum() / means.amps.length).toFixed(1);
    means.voltMean=(means.volts.sum() / means.volts.length).toFixed(1);

    if(means.voltMean<BATTERY_VOLTAGE_MIN){
        means.voltMean=BATTERY_VOLTAGE-2;
    }

    if(desiredWatts<1){
        turnOff();
        return;
    }

    if(
        means.voltMean >= BATTERY_VOLTAGE
    ){
        desiredWatts-=RAMPDOWN_WATTAGE;
        if(desiredWatts<1){
            turnOff();
            return;
        }
    }

    if(
        means.ampMean*means.voltMean > desiredWatts+200
        || means.ampMean*means.voltMean < desiredWatts-300
    ){
        sendData(
            charger,
            formatMessage(
                desiredWatts/means.voltMean
            )
        );
    }
}

function parseIdle(data){
    data=data.slice(IDLE.length,data.length-3).replace(/[A-Z]/ig,'').split(',');
    chargerState.mainsV= Number(data[0]);
    chargerState.battV = Number(data[1]);
    chargerState.calibratedBattV=Number(data[1])+BATT_OFFSET
    chargerState.outA = Number(data[2]);

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

    if(
        chargerState.calibratedBattV<BATTERY_VOLTAGE
        && chargerState.calibratedBattV>BATTERY_VOLTAGE_MIN
    ){
        var amps=0;
        desiredWatts=DEFAULT_120_WATTS;
        amps=Math.round(
            DEFAULT_120_WATTS
            /(chargerState.calibratedBattV)
        );

        if(chargerState.mainsV>120){
            desiredWatts=DEFAULT_240_WATTS;
            amps=Math.round(
                DEFAULT_240_WATTS
                /(chargerState.calibratedBattV)
            );
        }

        if(IS_JPLUG){
            desiredWatts=MAX_WATTAGE;
            amps=Math.round(
                desiredWatts
                /(chargerState.calibratedBattV)
            );
        }

        sendData(
            charger,
            formatMessage(amps)
        );
        return;
    }

    desiredWatts=0;
}

function parseTotalCharge(data){
    data=data.replace(TOTAL_CHARGED,'')
        .replace('M,','');
    totalAHCharged=Number(data);
    //do nothing
}

function chargeStarted(data){
    clearTimeout(autoStart);
    data=data.replace(STARTED_CHARGE,'')
        .replace(/,E/g,'')
        .split(',');

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
        case 'setOut' :
            //console.log(message.type,message.data);
            stopped=false;
            desiredWatts=Number(message.data.W);

            if(desiredWatts>MAX_WATTAGE){
                desiredWatts=MAX_WATTAGE;
            }

            sendData(
                charger,
                formatMessage(
                    Math.round(
                        (desiredWatts||DEFAULT_120_WATTS)/(chargerState.calibratedBattV)
                    )
                )
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
            break;
        case 'connect' :
            broadcast();
            break;
    }
}
