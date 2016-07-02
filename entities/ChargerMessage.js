'use strict';
const COMMAND='M,ccc,vvv,sss,E';
const STANDBY='M,001,000,001,E';

const IDLE='M,R:M';
const CHARGING='M,S:D';
const STARTED_CHARGE='M,M,';
const CHARGE_COMPLETE='M,DONE,E';
const TOTAL_CHARGED='AH,E';
const JPLUG='J:';

const CHARGER_LIMITS='M,I:';

Array.prototype.sum = function() {
    return this.reduce(function(a,b){return a+b;});
};

class ChargerMessage{
    constructor(charger){
        this.charger=charger;
    }

    parse(){
        data=data.replace(/[^a-z0-9,:]/ig,'');

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

        if(data.indexOf(CHARGER_LIMITS)==0){
            console.log('??? : ',data);
        }
    }
}
