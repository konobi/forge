var dhcp_server = require('node-dhcpd');
var netmask = require('netmask').Netmask;
var ee = require('events').EventEmitter;
var util = require('util');
var clone = require('clone');
var async = require('async');

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
lease_store.prototype.remove_lease = function remove_lease (mac_addr, cb) {
  // XXX this should probably be made to be a lot more careful
  this.get_lease(mac_addr, function(lease){
    delete ip_map[ lease.yiaddr ];
    delete leases[mac_addr];
    cb();
  });
}
lease_store.prototype.save_lease = function save_lease (lease, cb) {
  var mac_addr = lease.chaddr;
  leases[mac_addr] = clone(lease);
  ip_map[lease.yiaddr] = mac_addr;
  cb();
};
lease_store.prototype.get_lease = function get_lease (mac_addr, cb) {
  var lease;
  if(leases[mac_addr]){
    // ensure we return a new copy!!
    lease = clone(leases[mac_addr]);
  }
  cb(lease);
};
lease_store.prototype.get_lease_by_ip = function get_lease_by_ip (ip, cb) {
  var lease;
  if(ip_map[ip]){
    lease = clone(leases[ ip_map[ip] ]);
  }
  cb(lease);
};
lease_store.prototype.get_next_ip = function get_next_ip (cb) {
  var latest = Object.keys(ip_map).sort()[-1];
  if(!latest) return cb(undefined);
  var next_ip = (ip2long(latest) + 1);
  cb(long2ip(next_ip));
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

  self.s.on('discover', self.discover.bind(self));
  self.s.on('request', self.request.bind(self));
  self.s.on('decline', self.decline.bind(self));
  self.s.on('release', self.release.bind(self));

  self.save_lease       = opts.save_lease;
  self.get_lease        = opts.get_lease;
  self.get_lease_by_ip  = opts.get_lease_by_ip;
  self.get_next_ip      = opts.get_next_ip;
  self.remove_lease     = opts.remove_lease;

  self.s.bind(67, '0.0.0.0', function() {
    //self.s.setBroadcast(true);
    //self.s.setTTL(255)
    self.s.setMulticastTTL(255);
    self.s.addMembership('239.255.255.249', self.host);
    self.s.setMulticastLoopback(true);
  });
  return self;
}
util.inherits(dhcpd, ee);

function _get_option(pkt, opt) {
  return pkt.options[opt];
}

dhcpd.prototype.pre_init = function pre_init (pkt, cb) {
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
  self.get_lease(pkt.chaddr, function(lease){
    // Get REQUESTED_IP if present
    var requested_ip = _get_option(pkt, DHCP_REQUESTED_IP);
    //console.dir(requested_ip_opt);
    return cb(lease, requested_ip);
  });

}

dhcpd.prototype.discover = function discover (pkt) {
    var self = this;
    console.log("Got DISCOVER request");

    var offer = {};
    offer.siaddr = self.host;
    offer.options = clone(pkt.options);
    offer.options['1'] = self.netmask;
    offer.options['3'] = self.routers;
    offer.options['28'] = self.broadcast;
    offer.options['51'] = self.default_lease;

    async.waterfall([
      function($cb){
        self.pre_init(pkt, function(lease, requested_ip){
          $cb(null, lease, requested_ip);
        });
      },
      function(lease, requested_ip, $cb) {
        if(lease){
          console.log("Using pre-existing lease's offer", lease);
          offer = lease.offer;
          return;
        }

        console.log("Creating new lease");
        var ip = requested_ip;
        if(ip && !self.get_lease_by_ip(ip) ){
          // An IP has been requested and isn't in use

          // If we recieve an IP as part of the discover, make sure it's in our range
          // otherwise NAK to put client back into INIT mode
          if( ip && (ip2long(self.start_end[0]) <= ip2long(ip) <= ip2long(self.start_end[1])) ){
            // Supplied IP is within the range
            console.log("Using ip requested by client");
            offer.yiaddr = ip;
            $cb(null);
          } else {
            console.log("Client requested invalid IP");
            return self.s.nak(pkt);
          }
        } else {
          // We need to get a new IP
          console.log("Getting new IP");
          self.get_next_ip(function (new_ip) {
            if(new_ip == undefined) new_ip = self.start_end[0];
            if(new_ip && (ip2long(self.start_end[0]) <= ip2long(new_ip) <= ip2long(self.start_end[1])) ){
              console.log("Using new IP of: "+new_ip);
              offer.yiaddr = new_ip;
              $cb(null);
            } else {
              // We don't have a new IP to offer =0(
              console.log("Unable to find IP for use, ignoring");
              return;
            }
          });
        }
        //var dhcp_host_opt = _get_option(pkt, DHCP_HOST_NAME);
        //offer.options[ DHCP_HOST_NAME ] = dhcp_host_opt;

      }
    ],
    function(err, result){

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

      console.log("Making an offer:\n\tmac: "+pkt.chaddr+"\n\tip: "+offer.yiaddr);
      return self.s.offer(pkt, offer);
    });

};

dhcpd.prototype.request = function request (pkt) {
    var self = this;
    var cur_request = requests[pkt.chaddr];
    console.log("GOT REQUEST");
    self.pre_init(pkt, function(lease, requested_ip) {
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
          console.log("Receieved valid request from '"+pkt.chaddr+"' for ip '"+cur_request.offer.yiaddr+"'");
          var mac_addr = pkt.chaddr + '';
          console.log("mac: "+mac_addr+"   chaddr:"+pkt.chaddr);
          var offer = clone(cur_request.offer);
          self.save_lease({
            yiaddr: cur_request.offer.yiaddr,
            offer: offer,
            chaddr: mac_addr
          }, function() {
            console.log("DONE");
            _clean_request(pkt.chaddr);
            return self.s.ack(pkt, offer);
          });
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
        console.log("ATTEMPTING TO GET LEASE FOR:  "+pkt.chaddr);
        if(lease) {
          // we got a lease back, lets update it and
          var offer = {};
          console.log("Got lease for host --- " +pkt.chaddr);
          //self.set_lease(offer, pkt);
          self.save_lease({
            chaddr: pkt.chaddr,
            yiaddr: lease.yiaddr,
            offer: clone(lease.offer)
          }, function(){
            return self.s.ack(pkt); // ???
          });
        } else {
          console.log("Didn't find a matching lease for this host");
          //_clean_request(pkt.chaddr);
          return self.s.nak(pkt);
        }

      }
  });
};

dhcpd.prototype.decline = function decline (pkt) {
    var cur_request = requests[pkt.chaddr];
    if(cur_request && cur_request.offer){
      self.remove_lease(pkt.chaddr, function(){
        _clean_request(pkt.chaddr);
      });
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
    self.remove_lease(pkt.chaddr, function(){});
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
    subnet: '192.168.119.0/24',
    range_start: '192.168.119.30',
    range_end: '192.168.119.60',
    routers: [ '192.168.119.1' ],
    nameservers: [ '8.8.8.8', '8.8.4.4' ],
    //set_lease: set_lease,
    save_lease: function(lease, cb){ store.save_lease(lease, cb) },
    get_lease: function(mac_addr, cb){ store.get_lease(mac_addr, cb) },
    get_lease_by_ip: function(ip, cb){ store.get_lease_by_ip(ip, cb) },
    get_next_ip: function(cb){ store.get_next_ip(cb) },
    remove_lease: function(mac_addr, cb){ store.remove_lease(mac_addr, cb) },
    host: '192.168.119.1'
});


module.exports = dhcpd;
