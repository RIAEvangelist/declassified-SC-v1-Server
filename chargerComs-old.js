var serialport = require("serialport");
var Message=require('js-message');
var WS=require('ws').Server;

const COMMAND='M,ccc,vvv,sss,E';
const STANDBY='M,001,000,001,E';

const IDLE='M,R:M';
const CHARGING='M,S:D';
const STARTED_CHARGE='M,M,';
const CHARGE_COMPLETE='M,DONE,E';
const TOTAL_CHARGED='AH,E';

const UNKNOWN_MESSAGE='M,I:';

const MAX_CURRENT=80;
const BATTERY_VOLTAGE=116;

const DEFAULT_120_CURRENT=14;
const DEFAULT_240_CURRENT=29;

const AUTO_START_TIMEOUT=5000;

var autoStart=false;


var server = new WS(
    {
        port: 19200,
        host: '0.0.0.0'
    }
);

var chargingState={
    dutyCycle:0,
    chargingCurrent:0,
    chargingVoltage:0,
    temp:0,
    chargedAmpHours:0
};

var chargeSettings={
    current:DEFAULT_120_CURRENT,
    voltage:BATTERY_VOLTAGE
};

var chargerState={
    mainsMaxVoltage:0,
    batteryVoltage:0,
    lastSetCurrent:0,
    lastSetVoltage:0,
    charging:chargingState,
    settings:chargeSettings
};

var totalAHCharged=0;

server.broadcast = function broadcast(message) {
    server.clients.forEach(
        function each(client) {
            if(!message){
                var message=new Message;
                message.type='chargerState';
                message.data=chargerState;
            }
            try{
                client.send(message.JSON);
            }catch(err){

            }
        }
    );
};

server.on(
    'connection',
    function connection(ws) {
        var message=new Message;
        message.type='chargerState';
        message.data=chargerState;

        ws.on(
            'message',
            handleRemoteCommand
        );

        try{
            ws.send(message.JSON);
        }catch(err){

        }
    }
);

var charger = new serialport.SerialPort(
    '/dev/ttyUSB0',
    {
        baudrate: 19200,
        parser: serialport.parsers.readline('\n')
    }
);

charger.on(
    'open',
    start
);

function start(){
    console.log('open');
    charger.on(
        'data',
        gotData
    );
}

function gotData(data){
    if(data.indexOf(CHARGING)==0){
        parseCharging(data);
    }

    if(data.indexOf(IDLE)==0){
        parseIdle(data);
    }

    if(data.indexOf(STARTED_CHARGE)==0){
        chargeStarted(data);
    }

    if(data.indexOf(CHARGE_COMPLETE)==0){
        chargeComplete();
    }

    if(data.indexOf(TOTAL_CHARGED)>0){
        parseTotalCharge(data);
    }

    if(data.indexOf(UNKNOWN_MESSAGE)==0){
        console.log('??? : ',data);
    }

    server.broadcast();
}

function sendData(message){
    charger.write(message+'\n');
}

function turnOff(){
    sendData(STANDBY);
}

function formatMessage(current,constantVoltage,reverseDirection){
    var signature=(current+BATTERY_VOLTAGE)%1000;
    var min='000';

    chargeSettings.current=current;

    current=min+current;
    voltage=min+BATTERY_VOLTAGE;

    if(constantVoltage){
        current+=300;
    }

    if(reverseDirection){
        current+=500;
    }

    signature=min+signature;

    current=current.slice(-3);
    voltage=voltage.slice(-3);
    signature=signature.slice(-3);

    var message=COMMAND.replace('ccc',current)
        .replace('vvv',BATTERY_VOLTAGE)
        .replace('sss',signature);

    return message;
}

function parseCharging(data){
    var data=data.slice(CHARGING.length,data.length-3).replace(/[A-Z]/ig,'').split(',');
    chargingState.dutyCycle         = Number(data[0])/100;
    chargingState.chargingCurrent   = Number(data[1])/10;
    chargingState.chargingVoltage   = Number(data[2]);
    chargingState.temp              = Number(data[3]);
    chargingState.chargedAmpHours   = Number(data[4]);
}

function parseIdle(data){
    var data=data.slice(IDLE.length,data.length-3).replace(/[A-Z]/ig,'').split(',');
    chargerState.mainsMaxVoltage= Number(data[0]);
    chargerState.batteryVoltage = Number(data[1]);
    chargerState.lastSetCurrent = Number(data[2]);
    chargerState.lastSetVoltage = Number(data[3]);

    if(chargerState.batteryVoltage<BATTERY_VOLTAGE && !autoStart){
        if(chargerState.mainsMaxVoltage<200){
            autoStart=setTimeout(
                function(){
                    sendData(
                        formatMessage(DEFAULT_120_CURRENT)
                    );
                },
                AUTO_START_TIMEOUT
            );
            return;
        }

        autoStart=setTimeout(
            function(){
                sendData(
                    formatMessage(DEFAULT_240_CURRENT)
                );
            },
            AUTO_START_TIMEOUT
        );
    }
}

function parseTotalCharge(data){
    var data=data.replace(TOTAL_CHARGED,'')
        .replace('M,','');
    totalAHCharged=Number(data);
    //do nothing
}

function chargeStarted(data){
    clearTimeout(autoStart);
    var data=data.replace(STARTED_CHARGE,'')
        .replace(/,E/g,'')
        .split(',');

    chargeSettings.current=Number(data[0]);
    chargeSettings.voltage=Number(data[1]);
}

function chargeComplete(){
    chargingState.dutyCycle= 0;
    chargingState.chargingCurrent = 0;
    chargingState.chargingVoltage = 0;
    chargingState.temp = 0;
}

function handleRemoteCommand(data){
    message=new Message;
    message.load(data);

    //console.log(message.JSON);

    switch(message.type){
        case 'setChargingCurrent' :
            //console.log(message.type,message.data);
            sendData(
                formatMessage(message.data.current)
            );
            break;
        case 'stopCharging' :
            turnOff();
            break;
    }
}
