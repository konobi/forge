#!/usr/bin/env node

var forge = require('./lib/forge');

var server = new forge({
    subnet: '172.16.184.0/24',
    range_start: '172.16.184.30',
    range_end: '172.16.184.60',
    routers: [ '172.16.184.1' ],
    nameservers: [ '8.8.8.8', '8.8.4.4' ],
    set_lease: set_lease,
    save_lease: save_lease,
    get_lease: get_lease,
    remove_lease: remove_lease
});

var leases = {};
var ip_2_mac = {};


function set_lease (offer, pkt) {
  // We have a new client, so lets make sure we set everything appropriately
  var lease = leases[pkt.chaddr];

  // the client has supplied the IP, so lets check it's availability
};

/*
 * XXX - Lets do in memory for now
 *
initialize_lmdb = function initialize_lmdb (opts) {
  var self = this;
  var env = new lmdb.Env();
  env.open({
        path: "./data/forge.db"
  });
  var dbi = env.openDbi({
    name: opts.ip_range,
    create: true
  });
};
*/
