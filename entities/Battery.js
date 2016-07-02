'use strict';

Array.prototype.sum = function() {
    return this.reduce(function(a,b){return a+b;});
};

class Battery{
    constructor(){
        this.max    =116;
        this.min    =70;
        this.offset =0;

        this.maxWattage=12000;

        this.voltBuffer = new Array(12).fill(0);
    }

    get volts(){
        return this.voltBuffer.sum();
    }

    set volts(){
        return this.volts;
    }

    get calibratedVolts(){
        return this.volts+this.offset;
    }

    set calibratedVolts(){
        return this.calibratedVolts;
    }
}

module.exports=Battery;
