// controllers/reportController.js
const { generateProReport, generateAdminReport, generateReportHTML, generateReportExcel } = require('../services/reportService');

exports.getProReport = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const reportData = await generateProReport(req.user.id, startDate, endDate);

    if (req.query.format === 'xlsx') {
      const buffer = await generateReportExcel(reportData);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="fixerr-pro-report.xlsx"');
      return res.send(buffer);
    }

    if (req.query.format === 'html' || req.query.download === 'true') {
      const html = generateReportHTML(reportData);
      res.setHeader('Content-Type', 'text/html');
      return res.send(html);
    }

    res.json({ success: true, report: reportData });
  } catch (err) {
    console.error('Pro report error:', err.message);
    res.status(500).json({ error: err.message || 'Could not generate professional report' });
  }
};

exports.getAdminReport = async (req, res) => {
  try {
    const { startDate, endDate, country, status } = req.query;
    const reportData = await generateAdminReport(startDate, endDate, country, status);

    if (req.query.format === 'xlsx') {
      const buffer = await generateReportExcel(reportData);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="fixerr-executive-report.xlsx"');
      return res.send(buffer);
    }

    if (req.query.format === 'html' || req.query.download === 'true') {
      const html = generateReportHTML(reportData);
      res.setHeader('Content-Type', 'text/html');
      return res.send(html);
    }

    res.json({ success: true, report: reportData });
  } catch (err) {
    console.error('Admin report error:', err.message);
    res.status(500).json({ error: err.message || 'Could not generate admin report' });
  }
};
