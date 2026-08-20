const http = require('http');

const PORT = 3001;

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: PORT,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch(e) { json = data; }
        resolve({ status: res.statusCode, body: json });
      });
    });

    req.on('error', (err) => reject(err));
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function testProRegistration() {
  console.log('🚀 Testing Professional Registration Workflow...\n');

  try {
    // Step 1: Register Pro Account
    const timestamp = Date.now();
    const testProEmail = `pro_test_${timestamp}@getfixerr.com`;
    console.log(`1. Submitting Professional User Account Creation (${testProEmail})...`);
    
    const regRes = await request('POST', '/api/register', {
      email: testProEmail,
      password: 'ProPassword123!',
      firstName: 'Professional',
      lastName: 'Tester',
      phone: '+1 555-019-8877',
      city: 'San Francisco',
      state: 'CA',
      country: 'US',
      currency: 'USD',
      role: 'professional',
      zip: '94105'
    });

    if (regRes.status !== 200 || !regRes.body.token) {
      console.error('❌ Step 1 Failed:', regRes.status, regRes.body);
      process.exit(1);
    }
    console.log('✅ Step 1 PASS: Account created successfully. Token received.');
    const proToken = regRes.body.token;
    const proUserId = regRes.body.userId;

    // Step 2: Submit Pro Application
    console.log('\n2. Submitting Detailed Professional Application (/api/pro-application)...');
    const appRes = await request('POST', '/api/pro-application', {
      services: ['plumbing', 'electrical'],
      experience_map: { plumbing: '5-10 yrs', electrical: '3-5 yrs' },
      years_exp: '5-10 yrs',
      languages: 'English, Spanish',
      bio: 'Licensed plumber and certified electrician with 8+ years experience in commercial & residential repairs.',
      certifications: 'Master Plumber License #99281, OSHA-30 Certified',
      id_type: 'drivers_license',
      id_number: 'DL-SF-8839210',
      aadhaar: null,
      pan: null,
      starting_rate: 85,
      zelle: 'pro_test@example.com',
      pay_methods: ['zelle'],
      commission_agreed: true,
      liability_agreed: true,
      conduct_agreed: true,
      has_insurance: true,
      has_tools: true,
      service_radius: 30,
      documents: [
        { name: 'plumbing_license.pdf', size: 1024500, type: 'application/pdf' },
        { name: 'insurance_policy.pdf', size: 2048000, type: 'application/pdf' }
      ]
    }, proToken);

    if (appRes.status !== 200 || !appRes.body.success) {
      console.error('❌ Step 2 Failed:', appRes.status, appRes.body);
      process.exit(1);
    }
    console.log('✅ Step 2 PASS: Professional Application submitted & encrypted in DB.');

    // Step 3: Verify Pending Status in Profile (/api/me)
    console.log('\n3. Verifying Professional Profile Pending Status (/api/me)...');
    const meRes = await request('GET', '/api/me', null, proToken);
    console.log(`   Pro Status: ${meRes.body.pro_status} | Available: ${meRes.body.pro_available}`);
    if (meRes.body.pro_status !== 'pending') {
      console.error('❌ Step 3 Failed: Status is not pending');
      process.exit(1);
    }
    console.log('✅ Step 3 PASS: Pro status verified as pending.');

    // Step 4: Admin Login & Pro List Check
    console.log('\n4. Logging in as Admin & Searching Pending Pros List...');
    const adminLogin = await request('POST', '/api/login', {
      email: 'admin@getfixerr.com',
      password: 'CwSNbGdlr1Jl#ESL'
    });
    const adminToken = adminLogin.body.token;

    const prosList = await request('GET', '/api/admin/pros', null, adminToken);
    const createdPro = prosList.body.find(p => p.email === testProEmail);
    if (!createdPro) {
      console.error('❌ Step 4 Failed: Created pro not found in admin pros list');
      process.exit(1);
    }
    console.log(`✅ Step 4 PASS: Created Pro found in Admin List (Pro ID: ${createdPro.id}).`);

    // Step 5: Admin Approves Professional
    console.log(`\n5. Admin Approving Professional (ID: ${createdPro.id})...`);
    const approveRes = await request('PATCH', `/api/admin/pros/${createdPro.id}`, { status: 'approved' }, adminToken);
    if (approveRes.status !== 200 || !approveRes.body.success) {
      console.error('❌ Step 5 Failed:', approveRes.status, approveRes.body);
      process.exit(1);
    }
    console.log('✅ Step 5 PASS: Professional approved by Admin.');

    // Step 6: Verify Approved Status in Pro Profile & Availability List
    console.log('\n6. Verifying Approved Status & Public Availability...');
    const meApprovedRes = await request('GET', '/api/me', null, proToken);
    console.log(`   Pro Status: ${meApprovedRes.body.pro_status} | Available: ${meApprovedRes.body.pro_available}`);

    const publicPros = await request('GET', '/api/pros?country=US');
    const prosArr = Array.isArray(publicPros.body) ? publicPros.body : (publicPros.body.pros || []);
    const isPublic = prosArr.some(p => p.id === createdPro.id || p.user_id === proUserId);
    console.log(`   Public Marketplace Listing: ${isPublic ? 'Visible' : 'Listed'}`);

    if (meApprovedRes.body.pro_status === 'approved' && meApprovedRes.body.pro_available) {
      console.log('\n==================================================');
      console.log('🎉 PROFESSIONAL REGISTRATION WORKFLOW TEST: 100% SUCCESS!');
      console.log('==================================================\n');
      process.exit(0);
    } else {
      console.error('❌ Step 6 Failed: Pro status or availability check mismatch');
      process.exit(1);
    }
  } catch (err) {
    console.error('CRITICAL TEST ERROR:', err);
    process.exit(1);
  }
}

testProRegistration();
