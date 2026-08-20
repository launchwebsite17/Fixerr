// routes/adminRoutes.js
const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { auth, admin } = require('../middleware/auth');

router.use('/admin', auth, admin);

router.get('/admin/pros', adminController.getPros);
router.patch('/admin/pros/:id', adminController.updatePro);
router.patch('/admin/pros/:id/status', adminController.updatePro);
router.patch('/requests/:id', adminController.updateBooking);
router.get('/admin/ad-leads', adminController.getAdLeads);
router.patch('/admin/ad-leads/:id', adminController.updateAdLead);
router.get('/admin/ads', adminController.getAds);
router.post('/admin/ads', adminController.createAd);
router.patch('/admin/ads/:id', adminController.updateAd);
router.get('/admin/custom', adminController.getCustomRequests);
router.patch('/admin/custom/:id', adminController.updateCustomRequest);
router.get('/admin/stats', adminController.getStats);
router.get('/admin/notifs', adminController.getNotifs);
router.patch('/admin/notifs/read-all', adminController.readAllNotifs);
router.get('/admin/db-view', adminController.dbView);
router.patch('/admin/db-view/:collection/:id', adminController.updateDbRecord);
router.delete('/admin/db-view/:collection/:id', adminController.deleteDbRecord);
router.post('/admin/backfill-geo', adminController.backfillGeo);
router.post('/admin/backfill-geo-customers', adminController.backfillGeoCustomers);
router.get('/admin/email-log', adminController.getEmailLog);
router.post('/admin/test-email', adminController.testEmail);
router.get('/admin/customers', adminController.getCustomers);
router.patch('/admin/customers/:id', adminController.updateCustomer);
router.delete('/admin/customers/:id', adminController.deleteCustomer);
router.patch('/admin/pros/:id/profile', adminController.updateProProfile);
router.delete('/admin/pros/:id', adminController.deletePro);
router.post('/admin/evaluation-fee', adminController.deductEvaluationFee);

module.exports = router;
