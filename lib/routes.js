
var Router = require('routes');
var router = new Router();

router.addRoute('/boot/:macaddr', function boot(macaddr) {

});

router.addRoute('/boot/:macaddr/preeseed.cfg', function preseed(macaddr) {

});

module.exports = router;

