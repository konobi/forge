var dhcp_server = require('node-dhcpd');
var netmask = require('netmask').Netmask;
var ee = require('events').EventEmitter;
var util = require('util');

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
  DHCP_MAXTYPE      = DHCP_INFORM
  DHCP_REQUESTED_IP = 0x32;


var leases = {};
function lease_store (){
}
lease_store.prototype.get_lease = function get_lease () {
}

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

  self.s.on('message',  self.message.bind(self));
  self.s.on('discover', self.discover.bind(self));
  self.s.on('request', self.request.bind(self));
  self.s.on('decline', self.decline.bind(self));
  self.s.on('release', self.release.bind(self));

  self.set_lease    = opts.save_lease;
  self.save_lease   = opts.save_lease;
  self.get_lease    = opts.get_lease;
  self.remove_lease = opts.remove_lease;

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

function pre_init (pkt) {
  // Ignore packet
  if(pkt.hlen != 6) return;

  // Ignore if this isn't a BOOTREQUEST
  if(pkt.op != BOOTREQUEST) return;

  var state = _get_option(pkt, DHCP_MESSAGE_TYPE);
  if(state == undefined || state[0] < DHCP_MINTYPE || state[0] > DHCP_MAXTYPE) return;

  // Get SERVER_ID if present
  var server_id_opt = _get_option(pkt, DHCP_SERVER_ID);
  console.dir(server_id_opt);
//  if (server_id_opt) {
//    uint32_t server_id_network_order;
//    move_from_unaligned32(server_id_network_order, server_id_opt);
//    if (server_id_network_order != self.host) {
//      return;
//    }
//  }

  // Look for a static/dynamic lease
//  var static_lease_nip = get_static_nip_by_mac(server_config.static_leases, pkt.chaddr);
//  if (static_lease_nip) {
//    bb_info_msg("Found static lease: %x", static_lease_nip);
//    memcpy(&fake_lease.lease_mac, &packet.chaddr, 6);
//    fake_lease.lease_nip = static_lease_nip;
//    fake_lease.expires = 0;
//    lease = &fake_lease;
//  } else {
//    lease = find_lease_by_mac(pkt.chaddr);
//  }

  // Get REQUESTED_IP if present
  var requested_ip_opt = _get_option(pkt, DHCP_REQUESTED_IP);
  console.dir(requested_ip_opt);
//  if (requested_ip_opt) {
//    move_from_unaligned32(requested_nip, requested_ip_opt);
//  return;
//  }
}

dhcpd.prototype.message = function message (msg) {
  console.log('Received msg', msg);
};




dhcpd.prototype.discover = function discover (pkt, ip) {
    var self = this;
    pre_init(pkt);

    // XXX - Grab new lease to offer
    // initialization state
    // http://technet.microsoft.com/en-us/library/cc958935.aspx
    //var subnet = self.subnet;

    // either grab the current IP for this MAC or return a new
    // ip address

    // If we recieve an IP as part of the discover, make sure it's in our range
    // otherwise NAK to put client back into INIT mode
    if( ip && (ip2long(self.start_end[0]) <= ip <= ip2long(self.start_end[1])) ){
      // Supplied IP is within the range
    } else {
      return self.s.nak(pkt);
    }

    if( ip && self.ip_in_use(ip, pkt) ){
      return self.s.nak(pkt);
    }

    var offer = {
      yiaddr: ip,
      options: {
        1: self.netmask,
        3: self.routers,
        28: self.broadcast,
        51: self.default_lease
      }
    };

    self.set_lease(offer, pkt);
    if( !offer.yiaddr ) {
      // We didn't get an IP, perhaps our range is full
      return;
    }

    // Lets forget about this request after 60 seconds
    var cleanup = function(){
      _clean_request(pkt.chaddr);
    };

    // Set a short-term record so we can match against XID
    requests[pkt.chaddr] = {
      xid: pkt.xid,
      chaddr: pkt.chaddr,
      offer: offer,
      when: new Date(),
      timeout_id: setTimeout(cleanup, 6000)
    };

    return self.s.offer(pkt, offer);
};

dhcpd.prototype.request = function request (pkt) {
    var cur_request = requests[pkt.chaddr];

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

exports.ip2long = function (ip_address) {
  var parts = ip_address.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  return parts.length === 4 ?
      parseInt(+parts[1],10) * 16777216 + parseInt(+parts[2],10) * 65536 +
      parseInt(+parts[3],10) * 256      + parseInt(+parts[4],10) * 1
    : false;
};

var server = new dhcpd({
    subnet: '172.16.184.0/24',
    range_start: '172.16.184.30',
    range_end: '172.16.184.60',
    routers: [ '172.16.184.1' ],
    nameservers: [ '8.8.8.8', '8.8.4.4' ],
    //set_lease: set_lease,
    //save_lease: save_lease,
    //get_lease: get_lease,
    //remove_lease: remove_lease,
    host: '192.168.119.1'
});


module.exports = dhcpd;
