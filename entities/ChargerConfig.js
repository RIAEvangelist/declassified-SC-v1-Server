'use strict';

Array.prototype.sum = function() {
    return this.reduce(function(a,b){return a+b;});
};

class ChargerConfig{
    constructor(){
        this.maxCurrent =99;
        this.default120Watts=1624;
        this.default240Watts=6240;
        this.rampdownWattage=100;

        this.startTime=new Date().getTime();
    }
}

module.exports=ChargerConfig;
