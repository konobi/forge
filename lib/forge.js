var dhcpd = require('./dhcpd');
var tftpd = require('tftp');
var http = require('http');
var router = require('./routes');
var url = require('url');
function Forge (opts) {
  var self = this;
  self.initialize_tftpd();
  self.initialize_httpd();
  self.initialize_dhcpd(opts);
}

Forge.prototype.initialize_tftpd = function initialize_tftpd (opts) {
  var self = this;
  self.tftpd = tftpd.createServer({
    host: '0.0.0.0',
    port: 69,
    root: './static/',
    denyPUT: true
  }).listen();
};

Forge.prototype.initialize_dhcpd = function initialize_dhcpd (opts) {
  var self = this;
  self.dhcpd = new dhcpd({
    subnet:           opts.subnet,
    range_start:      opts.range_start,
    range_end:        opts.range_end,
    routers:          opts.routers,
    nameservers:      opts.nameservers,
    save_lease:       opts.save_lease,
    get_lease:        opts.get_lease,
    get_lease_by_ip:  opts.get_lease_by_ip,
    get_next_ip:      opts.get_next_ip,
    remove_lease:     opts.remove_lease,
    host:             opts.host
  });
};

Forge.prototype.initialize_httpd = function initialize_httpd (opts) {
  var self = this;
  self.httpd = http.createServer(function (req, res) {
    console.log("#####>>> GOT HTTP REQUEST");
    var path = url.parse(req.url).pathname;
    var match = router.match(path);
    match.fn(req, res, match);
  }).listen(80, '0.0.0.0');
}

module.exports = Forge;
