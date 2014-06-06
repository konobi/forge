
var Router = require('routes');
var router = new Router();

router.addRoute('/chain', function(req, res, params, splats) {
  console.log("Got a CHAIN request");
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end("#!ipxe\n\necho Attempting to boot into the chain... \nchain http://${next-server}/boot/${mac}\n");
});

router.addRoute('/boot/:macaddr', function boot(req, res, params, splats) {
  console.log("Got a BOOT request");
  console.log("Just got word that "+params.params.macaddr+" just booted");
  res.writeHead(500);
  res.end();
});

router.addRoute('/boot/:macaddr/preeseed.cfg', function preseed(macaddr) {

});

module.exports = router;

