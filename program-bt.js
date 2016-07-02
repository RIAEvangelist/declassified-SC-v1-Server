var cmd=require('node-cmd');
var BTP=require('bluetooth-programmer');

cmd.get(
    `
echo BB-UART1 > /sys/devices/bone_capemgr.*/slots && echo BB-UART2 > /sys/devices/bone_capemgr.*/slots
    `,
    start
);

function start(){
    BTP.connect(
        {
            comName : '/dev/ttyO1',
            baud    : 9600
        },
        connectedToBT
    );
}

function connectedToBT(){
    console.log('connected');
    this.on(
        "data",
        function(data){
            console.log('data',data);
        }
    );

    this.on(
        "close",
        function(){
            console.log('closed');
        }
    );

    this.on(
        "error",
        function(err){
            console.log('error',err);
        }
    );

    this.BTName('SuperCharger-prototype');

    this.BTPin('0000');

    this.BTParity('None');

    this.BTBaud(19200);

    this.BTTest();

}
