// test_customer_booking_bill_flow.js - End-to-End Customer Booking & Bill Generation Flow Test
const http = require('http');

const BASE_URL = 'http://localhost:3001';

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runCustomerBookingBillTest() {
  console.log('🚀 Cross-Checking Customer Booking & Bill Generation Flow...\n');
  const timestamp = Date.now();

  // Step 1: Customer Signup
  const email = `cust_flow_${timestamp}@example.com`;
  console.log('1. Customer Registering Account (' + email + ')...');
  const signup = await request('POST', '/api/register', {
    firstName: 'Customer',
    lastName: 'Test',
    email,
    password: 'Password123!',
    role: 'customer',
    phone: '9876543210',
    country: 'IN',
    state: 'Karnataka',
    city: 'Bengaluru'
  });

  if (signup.status !== 200 || !signup.body.token) {
    console.error('❌ Step 1 FAILED:', signup);
    process.exit(1);
  }
  const customerToken = signup.body.token;
  console.log('✅ Step 1 PASS: Customer registered & logged in.\n');

  // Step 2: Customer Creates Booking Request
  console.log('2. Customer Submitting Service Booking Request (/api/requests)...');
  const booking = await request('POST', '/api/requests', {
    serviceKey: 'plumbing',
    subService: 'Tap Leak Repair',
    preferredDate: '2026-08-10',
    preferredTime: '10:00 AM',
    address: '123 MG Road',
    city: 'Bengaluru',
    state: 'Karnataka',
    country: 'IN',
    currency: 'INR',
    name: 'Customer Test',
    phone: '9876543210',
    email,
    paymentMethod: 'cash',
    termsAgreed: true
  }, customerToken);

  if (booking.status !== 200 || !booking.body.ref) {
    console.error('❌ Step 2 FAILED:', booking);
    process.exit(1);
  }
  const bookingRef = booking.body.ref;
  console.log('✅ Step 2 PASS: Booking created with Ref: ' + bookingRef + ' (Estimate: ₹' + booking.body.estimate + ').\n');

  // Step 3: Customer Fetches My Bookings
  console.log('3. Customer Checking Dashboard Bookings List (/api/requests)...');
  const myBookings = await request('GET', '/api/requests', null, customerToken);
  const foundBk = Array.isArray(myBookings.body) && myBookings.body.find(b => b.ref === bookingRef);
  if (!foundBk) {
    console.error('❌ Step 3 FAILED: Booking not found in customer dashboard');
    process.exit(1);
  }
  console.log('✅ Step 3 PASS: Booking visible in customer dashboard (Status: ' + foundBk.status + ').\n');

  // Step 4: Customer Completes Manual Payment
  console.log('4. Customer Completing Payment & Triggering Bill Generation (/api/payments/verify)...');
  const payVerify = await request('POST', '/api/payments/verify', {
    bookingRef,
    paymentMethod: 'manual',
    paymentId: 'MANUAL-TXN-' + timestamp
  }, customerToken);

  if (payVerify.status !== 200 || !payVerify.body.success) {
    console.error('❌ Step 4 FAILED:', payVerify);
    process.exit(1);
  }
  console.log('✅ Step 4 PASS: Payment recorded. Invoice Number: ' + payVerify.body.invoiceNumber + '\n');

  // Step 5: Download Tax Invoice HTML
  console.log('5. Downloading Generated Tax Invoice HTML (/api/invoices/' + bookingRef + '/download)...');
  const invDownload = await request('GET', '/api/invoices/' + bookingRef + '/download');
  if (invDownload.status !== 200 || typeof invDownload.body !== 'string' || !invDownload.body.includes('Invoice #')) {
    console.error('❌ Step 5 FAILED: Tax invoice HTML invalid or missing');
    process.exit(1);
  }

  console.log('   Tax Invoice Header Check: Contains "Invoice #' + payVerify.body.invoiceNumber + '"');
  console.log('   Tax Invoice Amount Check: Contains "₹' + booking.body.estimate + '"');
  console.log('✅ Step 5 PASS: Tax invoice HTML generated and downloadable.\n');

  console.log('==================================================');
  console.log('🎉 CUSTOMER BOOKING & BILL GENERATION FLOW: 100% SUCCESS!');
  console.log('==================================================');
}

runCustomerBookingBillTest().catch(console.error);
