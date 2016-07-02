var BTP=require('bluetooth-programmer');

function start(){
    BTP.connect(
        {
            comName : '/dev/USB0',//'/dev/ttyO1',
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

    this.BTName('Kanneda');

    this.BTPin('0000');

    this.BTParity('None');

    this.BTBaud(19200);

    this.BTTest();

}
