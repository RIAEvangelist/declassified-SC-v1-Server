const SerialPort = require("serialport");



charger = new SerialPort(
    '/dev/ttyUSB0',
    {
        baudrate: 19200,
        parser: SerialPort.parsers.readline('\n')
    }
);


charger.on(
    'data',
    gotData
);

function gotData(){
    console.log(arguments)
}
