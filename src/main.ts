/*
 * Created with @iobroker/create-adapter v2.6.2
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
import * as utils from '@iobroker/adapter-core'
import axios from 'axios'

// Load your modules here, e.g.:
// import * as fs from "fs";

const bascloudUrl = 'https://api.bascloud.net'

const readingsWrite: {
  [index: string]: {
    localId: string
    remoteId: string
    intervalEnabled: boolean
    interval: number
    intervalUnit: 'm' | 'h' | 'd'
    intervalFunction: 'last' | 'min' | 'max'
    alwaysSend: boolean

    funcInterval?: NodeJS.Timeout
    lastValue?: number
    lastValueTransmitted?: boolean
  }
} = {}

const readingsRead: {
  [index: string]: {
    localId: string
    remoteId: string
    unit: string
    interval: number
    intervalUnit: 'm' | 'h' | 'd'

    funcInterval?: NodeJS.Timeout
  }
} = {}

class Bascloud extends utils.Adapter {
  public constructor(options: Partial<utils.AdapterOptions> = {}) {
    super({
      ...options,
      name: 'bascloud',
    })
    this.on('ready', this.onReady.bind(this))
    this.on('stateChange', this.onStateChange.bind(this))
    // this.on('objectChange', this.onObjectChange.bind(this));
    // this.on('message', this.onMessage.bind(this));
    this.on('unload', this.onUnload.bind(this))
  }

  /**
   * Is called when databases are connected and adapter received configuration.
   */
  private async onReady(): Promise<void> {
    // Initialize your adapter here
    axios.defaults.timeout = 5000

    // Subscribe to all write readings
    if (this.config.readingsWrite) {
      this.config.readingsWrite.forEach(async (reading) => {
        readingsWrite[reading.localId] = reading
        readingsWrite[reading.localId].lastValueTransmitted = true
        let intervalTimeout = reading.interval * 1000 * 60 // default to minutes
        if (reading.intervalUnit === 'h') {
          intervalTimeout = intervalTimeout * 60
        } else if (reading.intervalUnit === 'd') {
          intervalTimeout = intervalTimeout * 60 * 24
        }
        readingsWrite[reading.localId].funcInterval = setInterval(
          this.bascloudIntervalTransmit.bind(this, reading.localId),
          intervalTimeout
        )
        this.subscribeForeignStates(reading.localId)
      })
    } else {
      console.warn('No readingsWrite defined')
    }

    // Subscribe to all read readings
    if (this.config.readingsRead) {
      this.config.readingsRead.forEach(async (reading) => {
        readingsRead[reading.localId] = reading
        let intervalTimeout = reading.interval * 1000 * 60 // default to minutes
        if (reading.intervalUnit === 'h') {
          intervalTimeout = intervalTimeout * 60
        } else if (reading.intervalUnit === 'd') {
          intervalTimeout = intervalTimeout * 60 * 24
        }

        // Create state if it doesn't exist
        await this.setObjectNotExistsAsync(reading.localId, {
          type: 'state',
          common: {
            name: reading.localId,
            type: 'number',
            role: 'indicator',
            read: true,
            write: true,
            unit: reading.unit,
          },
          native: {},
        })

        // Set interval to read from bascloud
        this.log.debug(`setting interval for ${reading.localId}`)
        this.bascloudRead(reading.localId)
        readingsRead[reading.localId].funcInterval = setInterval(
          this.bascloudRead.bind(this, reading.localId),
          intervalTimeout
        )
      })
    } else {
      console.warn('No readingsRead defined')
    }

    if (this.config.sendOnStart) {
      Object.keys(readingsWrite).forEach((key) => {
        this.bascloudTransmitNoCache(key)
      })
    }
  }

  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   */
  private onUnload(callback: () => void): void {
    try {
      // Here you must clear all timeouts or intervals that may still be active
      Object.keys(readingsWrite).forEach((key) => {
        if (readingsWrite[key].funcInterval)
          clearInterval(readingsWrite[key].funcInterval)
      })
      callback()
    } catch (e) {
      callback()
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
  private onStateChange(
    id: string,
    state: ioBroker.State | null | undefined
  ): void {
    if (state) {
      // The state was changed
      this.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`)
      if (!readingsWrite[id].intervalEnabled) {
        this.bascloudTransmitValue(id, state.val as number)
      } else {
        this.bascloudSetCacheValue(id, state.val as number)
      }
    } else {
      // The state was deleted
      this.log.debug(`state ${id} deleted`)
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

  private bascloudRead(id: string): void {
    this.log.debug(`reading from bascloud: ${id}`)
    const reading = readingsRead[id]
    const config = {
      method: 'get',
      maxBodyLength: Infinity,
      url: `${bascloudUrl}/v2/tenants/${this.config.tenantId}/devices/${reading.remoteId}/readings?page[size]=1`,
      headers: {
        'Content-Type': 'application/vnd.api+json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
    }
    axios(config)
      .then((res) => {
        if (res.data.data.length > 0) {
          this.log.debug('setting state from bascloud for id: ' + id)
          const val = res.data.data[0].attributes.value
          this.setState(id, val, true)
        }
      })
      .catch((error) => {
        this.log.error(`state ${id} failed to read from bascloud: ${error}`)
      })
  }

  private bascloudSetCacheValue(id: string, val: number): void {
    this.log.debug(`setting cache value ${id} to ${val}`)
    const f = readingsWrite[id].intervalFunction
    switch (f) {
      case 'last':
        readingsWrite[id].lastValue = val
        break
      case 'min':
        if (readingsWrite[id].lastValue === undefined) {
          readingsWrite[id].lastValue = val
        } else {
          readingsWrite[id].lastValue = Math.min(
            readingsWrite[id].lastValue!,
            val
          )
        }
        break
      case 'max':
        if (readingsWrite[id].lastValue === undefined) {
          readingsWrite[id].lastValue = val
        } else {
          readingsWrite[id].lastValue = Math.max(
            readingsWrite[id].lastValue!,
            val
          )
        }
        break
    }
    readingsWrite[id].lastValueTransmitted = false
  }

  private bascloudIntervalTransmit(id: string): void {
    this.log.debug(
      `interval transmit for ${id}, alwaysSend: ${readingsWrite[id].alwaysSend}, lastValueTransmitted: ${readingsWrite[id].lastValueTransmitted}`
    )
    if (
      !readingsWrite[id].alwaysSend &&
      readingsWrite[id].lastValueTransmitted
    ) {
      return
    }
    if (readingsWrite[id].lastValue !== undefined) {
      this.bascloudTransmitValue(id, readingsWrite[id].lastValue!)
      readingsWrite[id].lastValueTransmitted = true
    } else {
      this.log.warn(`no cache value to transmit for ${id}`)
      this.bascloudTransmitNoCache(id)
    }
  }

  private bascloudTransmitNoCache(id: string): void {
    // try to read from state
    this.getForeignState(id, (err, state) => {
      if (state) {
        this.bascloudTransmitValue(id, state.val as number)
        readingsWrite[id].lastValue = state.val as number // update cache so we donot need to read from state again
        readingsWrite[id].lastValueTransmitted = true
      } else {
        this.log.error(`no value to transmit for ${id}`)
      }
    })
  }

  private bascloudTransmitValue(id: string, val: number): void {
    const reading = this.config.readingsWrite.find(
      (reading) => reading.localId === id
    )

    const data = JSON.stringify({
      data: {
        type: 'readings',
        attributes: {
          value: val,
          timestamp: new Date().toISOString(),
        },
        relationships: {
          device: {
            data: {
              type: 'devices',
              id: reading?.remoteId,
            },
          },
        },
      },
    })
    const config = {
      method: 'post',
      maxBodyLength: Infinity,
      url: `${bascloudUrl}/v2/tenants/${this.config.tenantId}/readings`,
      headers: {
        'Content-Type': 'application/vnd.api+json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      data: data,
    }
    axios(config)
      .then((res) => {
        this.log.debug(
          `state ${id} sent to bascloud successfully: ${JSON.stringify(
            res.data
          )}`
        )
      })
      .catch((error) => {
        this.log.error(`state ${id} failed to send to bascloud: ${error}`)
      })
  }
}

if (require.main !== module) {
  // Export the constructor in compact mode
  module.exports = (options: Partial<utils.AdapterOptions> | undefined) =>
    new Bascloud(options)
} else {
  // otherwise start the instance directly
  ;(() => new Bascloud())()
}
