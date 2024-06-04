"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var utils = __toESM(require("@iobroker/adapter-core"));
var import_axios = __toESM(require("axios"));
const bascloudUrl = "https://api.bascloud.net";
const readingsWrite = {};
const readingsRead = {};
class Bascloud extends utils.Adapter {
  constructor(options = {}) {
    super({
      ...options,
      name: "bascloud"
    });
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }
  /**
   * Is called when databases are connected and adapter received configuration.
   */
  async onReady() {
    import_axios.default.defaults.timeout = 5e3;
    if (this.config.readingsWrite) {
      this.config.readingsWrite.forEach(async (reading) => {
        readingsWrite[reading.localId] = reading;
        readingsWrite[reading.localId].lastValueTransmitted = true;
        let intervalTimeout = reading.interval * 1e3 * 60;
        if (reading.intervalUnit === "h") {
          intervalTimeout = intervalTimeout * 60;
        } else if (reading.intervalUnit === "d") {
          intervalTimeout = intervalTimeout * 60 * 24;
        }
        readingsWrite[reading.localId].funcInterval = setInterval(
          this.bascloudIntervalTransmit.bind(this, reading.localId),
          intervalTimeout
        );
        this.subscribeForeignStates(reading.localId);
      });
    } else {
      console.warn("No readingsWrite defined");
    }
    if (this.config.readingsRead) {
      this.config.readingsRead.forEach(async (reading) => {
        readingsRead[reading.localId] = reading;
        let intervalTimeout = reading.interval * 1e3 * 60;
        if (reading.intervalUnit === "h") {
          intervalTimeout = intervalTimeout * 60;
        } else if (reading.intervalUnit === "d") {
          intervalTimeout = intervalTimeout * 60 * 24;
        }
        await this.setObjectNotExistsAsync(reading.localId, {
          type: "state",
          common: {
            name: reading.localId,
            type: "number",
            role: "indicator",
            read: true,
            write: true,
            unit: reading.unit
          },
          native: {}
        });
        this.log.debug(`setting interval for ${reading.localId}`);
        this.bascloudRead(reading.localId);
        readingsRead[reading.localId].funcInterval = setInterval(
          this.bascloudRead.bind(this, reading.localId),
          intervalTimeout
        );
      });
    } else {
      console.warn("No readingsRead defined");
    }
  }
  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   */
  onUnload(callback) {
    try {
      Object.keys(readingsWrite).forEach((key) => {
        if (readingsWrite[key].funcInterval)
          clearInterval(readingsWrite[key].funcInterval);
      });
      callback();
    } catch (e) {
      callback();
    }
  }
  // If you need to react to object changes, uncomment the following block and the corresponding line in the constructor.
  // You also need to subscribe to the objects with `this.subscribeObjects`, similar to `this.subscribeStates`.
  // /**
  //  * Is called if a subscribed object changes
  //  */
  // private onObjectChange(id: string, obj: ioBroker.Object | null | undefined): void {
  // 	if (obj) {
  // 		// The object was changed
  // 		this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
  // 	} else {
  // 		// The object was deleted
  // 		this.log.info(`object ${id} deleted`);
  // 	}
  // }
  /**
   * Is called if a subscribed state changes
   */
  onStateChange(id, state) {
    if (state) {
      this.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
      if (!readingsWrite[id].intervalEnabled) {
        this.bascloudTransmitState(id, state);
      } else {
        this.bascloudSetValue(id, state.val);
      }
    } else {
      this.log.debug(`state ${id} deleted`);
    }
  }
  // If you need to accept messages in your adapter, uncomment the following block and the corresponding line in the constructor.
  // /**
  //  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
  //  * Using this method requires "common.messagebox" property to be set to true in io-package.json
  //  */
  // private onMessage(obj: ioBroker.Message): void {
  // 	if (typeof obj === 'object' && obj.message) {
  // 		if (obj.command === 'send') {
  // 			// e.g. send email or pushover or whatever
  // 			this.log.info('send command');
  // 			// Send response in callback if required
  // 			if (obj.callback) this.sendTo(obj.from, obj.command, 'Message received', obj.callback);
  // 		}
  // 	}
  // }
  bascloudRead(id) {
    this.log.debug(`reading from bascloud: ${id}`);
    const reading = readingsRead[id];
    const config = {
      method: "get",
      maxBodyLength: Infinity,
      url: `${bascloudUrl}/v2/tenants/${this.config.tenantId}/devices/${reading.remoteId}/readings?page[size]=1`,
      headers: {
        "Content-Type": "application/vnd.api+json",
        Authorization: `Bearer ${this.config.apiKey}`
      }
    };
    (0, import_axios.default)(config).then((res) => {
      if (res.data.data.length > 0) {
        this.log.debug("setting state from bascloud for id: " + id);
        const val = res.data.data[0].attributes.value;
        this.setState(id, val, true);
      }
    }).catch((error) => {
      this.log.error(`state ${id} failed to read from bascloud: ${error}`);
    });
  }
  bascloudSetValue(id, val) {
    this.log.debug(`setting cache value ${id} to ${val}`);
    const f = readingsWrite[id].intervalFunction;
    switch (f) {
      case "last":
        readingsWrite[id].lastValue = val;
        break;
      case "min":
        if (readingsWrite[id].lastValue === void 0) {
          readingsWrite[id].lastValue = val;
        } else {
          readingsWrite[id].lastValue = Math.min(
            readingsWrite[id].lastValue,
            val
          );
        }
        break;
      case "max":
        if (readingsWrite[id].lastValue === void 0) {
          readingsWrite[id].lastValue = val;
        } else {
          readingsWrite[id].lastValue = Math.max(
            readingsWrite[id].lastValue,
            val
          );
        }
        break;
    }
    readingsWrite[id].lastValueTransmitted = false;
  }
  bascloudIntervalTransmit(id) {
    if (readingsWrite[id].lastValueTransmitted) {
      return;
    }
    if (readingsWrite[id].lastValue !== void 0) {
      this.bascloudTransmitValue(id, readingsWrite[id].lastValue);
      readingsWrite[id].lastValueTransmitted = true;
    }
  }
  bascloudTransmitState(id, state) {
    this.bascloudTransmitValue(id, state.val);
  }
  bascloudTransmitValue(id, val) {
    const reading = this.config.readingsWrite.find(
      (reading2) => reading2.localId === id
    );
    const data = JSON.stringify({
      data: {
        type: "readings",
        attributes: {
          value: val,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        },
        relationships: {
          device: {
            data: {
              type: "devices",
              id: reading == null ? void 0 : reading.remoteId
            }
          }
        }
      }
    });
    const config = {
      method: "post",
      maxBodyLength: Infinity,
      url: `${bascloudUrl}/v2/tenants/${this.config.tenantId}/readings`,
      headers: {
        "Content-Type": "application/vnd.api+json",
        Authorization: `Bearer ${this.config.apiKey}`
      },
      data
    };
    (0, import_axios.default)(config).then((res) => {
      this.log.debug(
        `state ${id} sent to bascloud successfully: ${JSON.stringify(
          res.data
        )}`
      );
    }).catch((error) => {
      this.log.error(`state ${id} failed to send to bascloud: ${error}`);
    });
  }
}
if (require.main !== module) {
  module.exports = (options) => new Bascloud(options);
} else {
  ;
  (() => new Bascloud())();
}
//# sourceMappingURL=main.js.map
