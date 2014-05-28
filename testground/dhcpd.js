var dhcp_server = require('node-dhcpd');
var netmask = require('netmask').Netmask;
var ee = require('events').EventEmitter;
var util = require('util');
var clone = require('clone');

var requests = {};
function _clean_request(mac_addr){
  if(requests[mac_addr]) {
    if( requests[mac_addr].offer && requests[mac_addr].offer.timeout_id){
      clearTimeout(requests[mac_addr].offer.timeout_id);
    }
    requests[mac_addr] = null;
    delete requests[mac_addr];
  }
}

const
  BOOTREQUEST       = 1,
  DHCP_MESSAGE_TYPE = 0x35,
  DHCP_SERVER_ID    = 0x36,
  DHCP_DISCOVER     = 1,
  DHCP_INFORM       = 8,
  DHCP_MINTYPE      = DHCP_DISCOVER,
  DHCP_MAXTYPE      = DHCP_INFORM,
  DHCP_REQUESTED_IP = 0x32,
  DHCP_HOST_NAME    = 0x0c;


var leases = {};
var ip_map = {};
function lease_store (){
  return this;
}
lease_store.prototype.save_lease = function save_lease (lease) {
  var mac_addr = lease.chaddr;
  leases[mac_addr] = lease;
  ip_map[lease.yiaddr] = mac_addr;
};
lease_store.prototype.get_lease = function get_lease (mac_addr) {
  if(leases[mac_addr]){
    // ensure we return a new copy!!
    return clone(leases[mac_addr]);
  }
  return;
};
lease_store.prototype.get_lease_by_ip = function get_lease_by_ip (ip) {
  if(ip_map[ip]){
    return leases[ ip_map[ip] ];
  }
  return;
};
lease_store.prototype.get_next_ip = function get_next_ip () {
  var latest = Object.keys(ip_map).sort()[-1];
  if(latest == undefined) return 0;
  var next_ip = (ip2long(latest) + 1);
  return long2ip(next_ip);
};

function dhcpd (opts) {
  var self = this;
  if(!(self instanceof dhcpd)){
    return new dhcpd(opts);
  }
  ee.call(self);

  self.s = dhcp_server.createServer('udp4');
  self.s.on("listening", function () {
      var address = self.s.address();
      console.log("server listening ------> " +
        address.address + ":" + address.port);
  });

  // 00:0C:29:27:19:FD

//  for( x in [ 'message', 'discover', 'request', 'decline', 'release' ] ){
//    self.s.on(x, self[x].bind(self));
//  }

  // cidr
  if(opts.subnet){
    var block = new netmask(opts.subnet);
    if(block){
      self.subnet_range = opts.range_start + "-" + opts.range_end;
      self.start_end    = self.subnet_range.split('-');
      self.network      = block.base;
      self.netmask      = block.mask;
      self.broadcast    = block.broadcast;

      self.routers       = opts.routers || [];
      self.nameservers   = opts.nameservers || [];
      self.default_lease = opts.default_lease || 3600;
                         // default lease time of one hour
      self.host = opts.host;
    } else {
      throw new Error("Unable to grok network details from '"+opts.subnet+"'");
    }
  }

  //self.s.on('message',  self.message.bind(self));
  self.s.on('discover', self.discover.bind(self));
  self.s.on('request', self.request.bind(self));
  self.s.on('decline', self.decline.bind(self));
  self.s.on('release', self.release.bind(self));

//  self.set_lease        = opts.save_lease;
  self.save_lease       = opts.save_lease;
  self.get_lease        = opts.get_lease;
  self.get_lease_by_ip  = opts.get_lease_by_ip;
  self.get_next_ip      = opts.get_next_ip;
//  self.remove_lease     = opts.remove_lease;

  self.s.bind(67, '0.0.0.0', function() {
    self.s.setMulticastTTL(255);
    self.s.addMembership('239.255.255.249', self.host);
  });
  return self;
}
util.inherits(dhcpd, ee);

function _get_option(pkt, opt) {
  return pkt.options[opt];
}

dhcpd.prototype.pre_init = function pre_init (pkt) {
  var self = this;
  // Ignore packet
  if(pkt.hlen != 6) return;

  // Ignore if this isn't a BOOTREQUEST
  if(pkt.op != BOOTREQUEST) return;

  var state = _get_option(pkt, DHCP_MESSAGE_TYPE);
  if(state == undefined || state[0] < DHCP_MINTYPE || state[0] > DHCP_MAXTYPE) return;

  // Get SERVER_ID if present
  var server_id_opt = _get_option(pkt, DHCP_SERVER_ID);
  //console.dir(server_id_opt);
  if (server_id_opt) {
    if (server_id_opt != self.host) {
      return;
    }
  }

  // Look for a static/dynamic lease
  var lease = self.get_lease(pkt.chaddr);

  // Get REQUESTED_IP if present
  var requested_ip_opt = _get_option(pkt, DHCP_REQUESTED_IP);
  //console.dir(requested_ip_opt);
  return [lease, requested_ip_opt];
}

//dhcpd.prototype.message = function message (msg) {
//  console.log('Received msg', msg);
//};


dhcpd.prototype.discover = function discover (pkt) {
    var self = this;
    var ret = self.pre_init(pkt);
    var lease = ret[0];
    var ip = ret[1];

    console.log("Got DISCOVER request");
    var offer = {};
    if(!lease){
      console.log("Creating new lease");
      if(ip && !self.get_lease_by_ip(ip) ){
        // An IP has been requested and isn't in use

        // If we recieve an IP as part of the discover, make sure it's in our range
        // otherwise NAK to put client back into INIT mode
        if( ip && (ip2long(self.start_end[0]) <= ip2long(ip) <= ip2long(self.start_end[1])) ){
          // Supplied IP is within the range
          console.log("Using ip requested by client");
          offer.yiaddr = ip;
        } else {
          console.log("Client requested invalid IP");
          return self.s.nak(pkt);
        }
      } else {
        // We need to get a new IP
        console.log("Getting new IP");
        var new_ip = self.get_next_ip();
        if(new_ip == undefined) new_ip = self.start_end[0];
        if(new_ip && (ip2long(self.start_end[0]) <= ip2long(new_ip) <= ip2long(self.start_end[1])) ){
          console.log("Using new IP of: "+new_ip);
          offer.yiaddr = new_ip;
        }else {
          // We don't have a new IP to offer =0(
          console.log("Unable to find IP for use, ignoring");
          return;
        }
      }

      offer.options = {
        1: self.netmask,
        3: self.routers,
        28: self.broadcast,
        51: self.default_lease,
      }
      //var dhcp_host_opt = _get_option(pkt, DHCP_HOST_NAME);
      //offer.options[ DHCP_HOST_NAME ] = dhcp_host_opt;

    } else {
      console.log("Using pre-existing lease's offer", lease);
      offer = lease.offer;
    }

    // Set a short-term record so we can match against XID
    if(!requests[pkt.chaddr]){
      // Lets forget about this request after 60 seconds
      var cleanup = function(){
        _clean_request(pkt.chaddr);
      };

      requests[pkt.chaddr] = {
        xid: pkt.xid,
        chaddr: pkt.chaddr,
        offer: offer,
        when: new Date(),
        timeout_id: setTimeout(cleanup, 60000)
      };
    }

/*
    self.save_lease({
      chaddr: pkt.chaddr,
      yiaddr: offer.yiaddr,
      offer_time: 60, //seconds
      offer: offer
    });
*/
    console.log("Making an offer:\n\tmac: "+pkt.chaddr+"\n\tip: "+offer.yiaddr);
    return self.s.offer(pkt, offer);
};

dhcpd.prototype.request = function request (pkt) {
    var cur_request = requests[pkt.chaddr];
    console.log("GOT REQUEST");
    if(cur_request) {
      // We're serving a request based on a DISCOVER

      // if we'll receive a request from a client
      // which sent a discover before but the xid
      // does not match, discard the offer we sent
      if(cur_request && cur_request.xid && cur_request.xid !== pkt.xid) {
        _clean_request(pkt.chaddr);
        return self.s.nak(pkt);
      }

      if(cur_request && cur_request.offer){
        console.log("Receieved valid request from '"+pkt.chaddr+"' for ip '"+request.offer.yiaddr+"'");
        self.save_lease(cur_request.offer, pkt);
        _clean_request(pkt.chaddr);
        return self.s.ack(pkt, request.offer);
      }
    } else {
      // We're serving a request from a client that either didn't
      // run a DISCOVER or has come back from reboot in INIT-REBOOT
      // phase
      // OR
      // we're getting a request due to the client going into RENEW
      // OR
      // we're getting a request from the client because it's lease
      // is about to expire
      var lease = self.get_lease(pkt);
      if(lease) {
        // we got a lease back, lets update it and
        var offer = {};
        console("Got lease for host");
        self.set_lease(offer, pkt);
        self.save_lease(offer, pkt);
        return self.s.ack(pkt); // ???
      } else {
        console.log("Didn't find a matching lease for this host");
        _clean_request(pkt.chaddr);
        return self.s.nak(pkt);
      }
    }
};

dhcpd.prototype.decline = function decline (pkt) {
    var cur_request = requests[pkt.chaddr];
    if(cur_request && cur_request.offer){
      self.remove_lease(pkt.chaddr);
      _clean_request(pkt.chaddr);
    }
    return;
};

dhcpd.prototype.release = function release (pkt) {
    var cur_request = requests[pkt.chaddr];
    // We shouldn't really get into a position where we've got a request
    // without a lease, but lets double check
    if(cur_request && cur_request.offer){
      _clean_request(pkt.chaddr);
    }
    self.remove_lease(pkt.chaddr);
};

dhcpd.prototype.inform = function inform (pkt) {
  // not currently supporting INFORM, so ignore
  return;
};

function long2ip(ip) {
  if (!isFinite(ip))
    return false;
  return '' + [ip >>> 24, ip >>> 16 & 0xFF, ip >>> 8 & 0xFF, ip & 0xFF].join('.');
}

function ip2long (ip_address) {
  var parts = ip_address.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  return parts.length == 5 ?
      parseInt(+parts[1],10) * 16777216 + parseInt(+parts[2],10) * 65536 +
      parseInt(+parts[3],10) * 256      + parseInt(+parts[4],10) * 1
    : false;
};

var store = new lease_store();

var server = new dhcpd({
    subnet: '172.16.184.0/24',
    range_start: '172.16.184.30',
    range_end: '172.16.184.60',
    routers: [ '172.16.184.1' ],
    nameservers: [ '8.8.8.8', '8.8.4.4' ],
    //set_lease: set_lease,
    //save_lease: save_lease,
    get_lease: function(){ store.get_lease(arguments) },
    get_lease_by_ip: function(){ store.get_lease_by_ip(arguments) },
    get_next_ip: function(){ store.get_next_ip(arguments) },
    //remove_lease: remove_lease,
    host: '192.168.119.1'
});


module.exports = dhcpd;
