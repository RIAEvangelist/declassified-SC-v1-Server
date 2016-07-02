    'use strict';

const ChargerConfig=require('./ChargerConfig.js');
const Battery=require('./Battery.js');
const JPlug=require('./JPlug.js');

Array.prototype.sum = function() {
    return this.reduce(function(a,b){return a+b;});
};

class Charger{
    constructor(Batt=Battery){
        this.config = new ChargerConfig;
        this.battery= new Batt;
        this.JPlug  = new JPlug;

        this.autoStartTimeout   =500; //start after 0.5sec
        this.autoStart          =false;

        this.mainsV         =0;
        this.stopped        =false;
        this.desiredWatts   =0;
        this.duty           =0;
        this.temp           =0;
        this.outAH          =0;
        this.chargingDuration =0;

        this.ampBuffer  = new Array(12).fill(0);
    }

    get amps(){
        return this.ampBuffer.sum();
    }

    set amps(){
        return this.amps;
    }
}
