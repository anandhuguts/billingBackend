import { supabase } from '../supabase/supabaseClient.js';

/**
 * 🚨 URGENT FIX: Account 533 Classification
 * 
 * This script fixes account 533 (Accounts Payable) to be classified as 'liability'
 * instead of 'asset'. This is critical for accounting integrity.
 */

async function fixAccount533() {
    console.log('🔧 Starting Account 533 Fix...\n');

    try {
        // 1️⃣ CHECK CURRENT STATE
        console.log('1️⃣ Checking current state of account 533...');
        const { data: before, error: beforeErr } = await supabase
            .from('coa')
            .select('id, tenant_id, name, type')
            .eq('id', 533)
            .single();

        if (beforeErr) {
            console.error('❌ Error checking account 533:', beforeErr.message);
            return;
        }

        if (!before) {
            console.log('⚠️ Account 533 not found in database');
            return;
        }

        console.log('Current state:');
        console.log(`  ID: ${before.id}`);
        console.log(`  Name: ${before.name}`);
        console.log(`  Type: ${before.type} ${before.type === 'liability' ? '✅' : '❌'}`);
        console.log('');

        // 2️⃣ FIX IF NEEDED
        if (before.type !== 'liability') {
            console.log('2️⃣ Fixing account 533...');

            const { error: updateErr } = await supabase
                .from('coa')
                .update({ type: 'liability' })
                .eq('id', 533);

            if (updateErr) {
                console.error('❌ Error updating account 533:', updateErr.message);
                return;
            }

            console.log('✅ Account 533 updated successfully!\n');
        } else {
            console.log('✅ Account 533 is already correct (type = liability)\n');
        }

        // 3️⃣ VERIFY THE FIX
        console.log('3️⃣ Verifying the fix...');
        const { data: after, error: afterErr } = await supabase
            .from('coa')
            .select('id, tenant_id, name, type')
            .eq('id', 533)
            .single();

        if (afterErr) {
            console.error('❌ Error verifying:', afterErr.message);
            return;
        }

        console.log('After fix:');
        console.log(`  ID: ${after.id}`);
        console.log(`  Name: ${after.name}`);
        console.log(`  Type: ${after.type} ${after.type === 'liability' ? '✅' : '❌'}`);
        console.log('');

        // 4️⃣ FIX ALL "Accounts Payable" ENTRIES
        console.log('4️⃣ Fixing ALL "Accounts Payable" accounts across all tenants...');

        const { data: allAP, error: allAPErr } = await supabase
            .from('coa')
            .select('id, tenant_id, name, type')
            .ilike('name', 'accounts payable');

        if (allAPErr) {
            console.error('❌ Error fetching Accounts Payable accounts:', allAPErr.message);
        } else {
            console.log(`Found ${allAP.length} "Accounts Payable" account(s):`);

            for (const acc of allAP) {
                const status = acc.type === 'liability' ? '✅ OK' : '❌ WRONG';
                console.log(`  - ID ${acc.id} (Tenant: ${acc.tenant_id}): ${acc.type} ${status}`);

                if (acc.type !== 'liability') {
                    console.log(`    Fixing...`);
                    const { error: fixErr } = await supabase
                        .from('coa')
                        .update({ type: 'liability' })
                        .eq('id', acc.id);

                    if (fixErr) {
                        console.error(`    ❌ Error: ${fixErr.message}`);
                    } else {
                        console.log(`    ✅ Fixed!`);
                    }
                }
            }
            console.log('');
        }

        // 5️⃣ FINAL VERIFICATION
        console.log('5️⃣ Final verification - checking all critical accounts...');

        const { data: criticalAccounts, error: criticalErr } = await supabase
            .from('coa')
            .select('name, type')
            .in('name', [
                'Accounts Payable',
                'Inventory',
                'VAT Input',
                'Cash',
                'Bank'
            ])
            .limit(20);

        if (criticalErr) {
            console.error('❌ Error:', criticalErr.message);
        } else {
            console.log('\nCritical Accounts Status:');
            console.log('┌─────────────────────┬────────────┬────────┐');
            console.log('│ Account             │ Type       │ Status │');
            console.log('├─────────────────────┼────────────┼────────┤');

            const expected = {
                'accounts payable': 'liability',
                'inventory': 'asset',
                'vat input': 'asset',
                'cash': 'asset',
                'bank': 'asset'
            };

            criticalAccounts.forEach(acc => {
                const expectedType = expected[acc.name.toLowerCase()];
                const status = acc.type === expectedType ? '✅' : '❌';
                console.log(`│ ${acc.name.padEnd(19)} │ ${acc.type.padEnd(10)} │ ${status}     │`);
            });

            console.log('└─────────────────────┴────────────┴────────┘');
        }

        console.log('\n✅ Fix complete! All Accounts Payable accounts should now be "liability"');
        console.log('\n📊 Your purchase accounting should now work correctly!');

    } catch (err) {
        console.error('💥 Unexpected error:', err);
    }
}

// Run the fix
fixAccount533()
    .then(() => {
        console.log('\n🎉 Script completed successfully!');
        process.exit(0);
    })
    .catch(err => {
        console.error('\n💥 Script failed:', err);
        process.exit(1);
    });
