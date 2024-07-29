'use strict';

var Service;
var Characteristic;
var request = require('request');

module.exports = function (homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    homebridge.registerAccessory('homebridge-synology-surveillance-homemode', 'SSHomeMode', HttpMultiswitch);
};

function HttpMultiswitch(log, config) {
    this.log = log;

    this.name = config.name || 'MultiSwitch';
    this.url = config.url;

    this.username = config.username || '';
    this.password = config.password || '';
    this.sessionToken = "";
    this.state = false;
}

HttpMultiswitch.prototype = {

    httpRequest: function (path, callback, recursive) {
        var _this = this;
        request({
                url: this.url + path + "&_sid=" + this.sessionToken,
                method: "GET",
                rejectUnauthorized: false,
            },
            function (error, response, body) {
                if (error && error.message.includes('EHOSTUNREACH')) {
                    //Host unreachable, return without further action
                    callback(error, response, body);
                    return;
                }

                var resp = (!error) ? JSON.parse(body) : null;
                if ((resp && resp.success) || recursive) {
                    callback(error, response, body);
                } else {
                    _this.httpRequest("/webapi/auth.cgi?api=SYNO.API.Auth&method=Login&version=3&account=" + _this.username + "&passwd=" + _this.password + "&session=SurveillanceStation&format=sid",
                        function (err, resp, bod) {
                            if (err || resp.statusCode != 200) {
                                _this.log.error("Unable to login, network error: " + bod);
                                return;
                            }

                            var r = JSON.parse(bod);
                            if (r.success) {
                                //OK logged in
                                _this.sessionToken = r.data.sid;
                                _this.log.info("Logged in.");
                                //Retry the request
                                _this.httpRequest(path, callback, true);
                            } else {
                                //Didn't work
                                _this.log.error("Unable to login, server error: " + bod);
                            }
                    }, true);
                }
            }
        );
    },

    getState: function (targetService, callback) {
        callback(null, this.state);

        this.httpRequest("/webapi/entry.cgi?api=SYNO.SurveillanceStation.HomeMode&version=1&method=GetInfo", function (error, response, responseBody) {
            if (error) {
                this.state = false;
                if (!error.message.includes('EHOSTUNREACH')) {
                    this.log.error('getPowerState failed: ' + error.message);
                    this.log('response: ' + response + '\nbody: ' + responseBody);
                }
            } else {
                var resp = JSON.parse(responseBody);
                if (resp && resp.data) {
                    this.state = !resp.data.on
                } else {
                    this.log.error("Unexpected response: " + responseBody);
                }
            }

            targetService.getCharacteristic(Characteristic.On).updateValue(this.state);
        }.bind(this));
    },

    setPowerState: function (targetService, powerState, callback) {
        var state = (powerState ? "off" : "on");
        this.httpRequest("/webapi/entry.cgi?api=SYNO.SurveillanceStation.HomeMode&version=1&method=Switch&" + state + "=true", function (error, response, responseBody) {
            if (error) {
                this.log.error('setPowerState failed: ' + error.message);
                this.log('response: ' + response + '\nbody: ' + responseBody);

                callback(error);
            } else {
                this.log.info('==> ' + (powerState ? "On" : "Off"));
                callback();
            }
        }.bind(this));
    },

    identify: function (callback) {
        this.log('Identify me Senpai!');
        callback();
    },

    getServices: function () {
        this.services = [];

        var informationService = new Service.AccessoryInformation();
        informationService
            .setCharacteristic(Characteristic.Manufacturer, 'Synology')
            .setCharacteristic(Characteristic.Model, 'Surveillance Station');
        this.services.push(informationService);


        var switchService = new Service.Switch(this.name);
        switchService
            .getCharacteristic(Characteristic.On)
            .on('set', this.setPowerState.bind(this, switchService))
            .on('get', this.getState.bind(this, switchService));

        this.services.push(switchService);

        return this.services;
    }
};
