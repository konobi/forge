var dhcp_server = require('node-dhcpd');
var netmask = require('netmask').Netmask;
var ee = require('events').EventEmitter;
var util = require('util');

function dhcpd (opts) {
  events.EventEmitter.call(this);
  var self = this;
  if(!(self instanceof dhcpd)){
    return new dhcpd(opts);
  }

  // cidr
  if(opts.subnet){
    var block = netmask(opts.subnet);
    if(block){
      self.network   = block.base;
      self.netmask   = block.mask;
      self.broadcast = block.broadcast;

      self.routers      = opts.routers;
      self.nameservers  = opts.nameservers;
      self.range        = opts.range;
      self.defaultLease = opts.defaultLease;
    } else {
      throw new Error("Unable to grok network details from '"+opts.subnet+"'");
    }
  }

  self.on('message',  self.message);
  self.on('discover', self.discover);
  self.on('request', self.request);
  return self;
}
util.inherits(dhcpd, events.EventEmitter);

dhcpd.prototype.message = function message (msg) {
  console.log('Received msg', msg);
};

dhcpd.prototype.discover = function discover (pkt, ip) {
    // XXX - Grab new lease to offer
    // initialization state
    // http://technet.microsoft.com/en-us/library/cc958935.aspx
    var subnet = config.subnets[0];
    ip = ip || randomIpInRange(subnet.range);

    requests[pkt.chaddr] = { xid: pkt.xid, chaddr: pkt.chaddr, ip: ip, when: new Date() };

    self.dhcpd.offer(pkt, {
      yiaddr: ip, // ip, from where?!
      options: {
        1: subnet.subnetMask,
        3: subnet.routers,
        28: subnet.broadcast,
        51: subnet.leaseTime
      }
    });

};

dhcpd.prototype.request = function request (pkt, ip) {
    // in request state, we either acknowledge
    // a lease or send a nak to notify the client
    // we can't serve his lease request.
    //
    // clients will initiate the rebinding state
    // after 50% of the lease time passed.
    //
    // http://technet.microsoft.com/en-us/library/cc958935.aspx
    var cur_request = requests[pkt.chaddr];
    // if we'll receive a request from a client
    // which sent a discover before but the xid
    // does not match, discard the offer we sent
    if(request && request.xid && request.xid !== pkt.xid) {
      cur_request = null;
      delete requests[pkt.chaddr];
    }

    if(request && request.ip){
      console.log("Receieved valid request from '"+pkt.chaddr+"' for ip '"+request.ip+"'");
      self.dhcpd.ack(pkt, {
        yiaddr: request.ip,
        options: {
          1: netmask,
          3: routers,
          28: broadcast,
          51: lease_time
        }
      });
      // XXX - we just gave out a new IP, so we should store it for now
      self.emit('new_ip', request.ip);
    } else {
      console.log("Didn't get a valid request for XID '"+request.xid+"'");
      self.dhcpd.nak(pkt);
    }
};

module.exports = dhcpd;
