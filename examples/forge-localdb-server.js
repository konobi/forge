#!/usr/bin/env node

var forge = require('./lib/forge');
var localdb = require('forge-localdb');

var store = new localdb({
  path: './leases.db',
  start: '192.168.119.30',
  end: '192.168.119.60
});

var server = new forge({
    subnet: '192.168.119.0/24',
    range_start: '192.168.119.30',
    range_end: '192.168.119.60',
    routers: [ '192.168.119.1' ],
    nameservers: [ '8.8.8.8', '8.8.4.4' ],
    save_lease: function(lease, cb){
      store.save_lease(lease, cb); },
    get_lease: function(mac_addr, cb){
      store.get_lease(mac_addr, cb); },
    get_lease_by_ip: function(ip, cb){
      store.get_lease_by_ip(ip, cb); },
    get_next_ip: function(cb){
      store.get_next_ip(cb); },
    remove_lease: function(mac_addr, cb){
      store.remove_lease(mac_addr, cb); },
    host: '192.168.119.1'
});

