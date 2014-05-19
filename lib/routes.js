
var Router = require('routes');
var router = new Router();

router.addRoute('/admin/*?', auth);
router.addRoute('/admin/users', adminUsers);

module.exports = router;

