var serialport = require("serialport");

var charger = new serialport.SerialPort(
    '/dev/ttyO1',
    {
        baudrate: 19200,
        parser: serialport.parsers.readline('\n')
    }
);

var bob = new serialport.SerialPort(
    '/dev/ttyO2',
    {
        baudrate: 19200,
        parser: serialport.parsers.readline('\n')
    }
);

charger.on(
    'open',
    chargerOpen
);

bob.on(
    'open',
    bobOpen
);


function chargerOpen(){
    setInterval(
        function(){
            console.log(123);
            charger.write('charger-\n-')
        },
        800
    );
}

function bobOpen(){
    setInterval(
        function(){
            console.log(456);
            bob.write('charger-\n-');
        },
        800
    );
}
