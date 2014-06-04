#!/usr/bin/env node

var forge = require('./lib/forge');
var mem_store = require('./lib/memory-store');

var store = new mem_store();

var server = new forge({
    subnet: '172.16.184.0/24',
    range_start: '172.16.184.30',
    range_end: '172.16.184.60',
    routers: [ '172.16.184.1' ],
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

