var clone = require('clone');

var leases = {};
var ip_map = {};

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
}

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

module.exports = lease_store;
