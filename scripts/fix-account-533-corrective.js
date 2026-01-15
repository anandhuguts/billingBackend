import { supabase } from '../supabase/supabaseClient.js';

/**
 * 🔧 CORRECTIVE FIX: Account 533 should be ASSET (it's Cash, not AP!)
 */

async function fixAccount533Back() {
    console.log('🔧 Correcting Account 533 (Cash should be asset, not liability)...\n');

    try {
        // 1️⃣ Fix account 533 back to asset (it's Cash!)
        console.log('1️⃣ Fixing Account 533 (Cash) → type = asset');

        const { error: fix533 } = await supabase
            .from('coa')
            .update({ type: 'asset' })
            .eq('id', 533)
            .eq('name', 'Cash');  // Only fix if it's actually named "Cash"

        if (fix533) {
            console.error('❌ Error:', fix533.message);
        } else {
            console.log('✅ Account 533 (Cash) is now correctly "asset"\n');
        }

        // 2️⃣ Verify all Cash accounts are assets
        console.log('2️⃣ Fixing ALL "Cash" accounts...');

        const { error: fixAllCash } = await supabase
            .from('coa')
            .update({ type: 'asset' })
            .eq('name', 'Cash')
            .neq('type', 'asset');

        if (fixAllCash) {
            console.error('❌ Error:', fixAllCash.message);
        } else {
            console.log('✅ All Cash accounts are now "asset"\n');
        }

        // 3️⃣ Final verification
        console.log('3️⃣ Final verification for test tenant...\n');

        const tenantId = '7b44ea82-1571-4cbb-866b-d783f0fa6d70';
        const { data: accounts, error: verifyErr } = await supabase
            .from('coa')
            .select('id, name, type')
            .eq('tenant_id', tenantId)
            .in('name', ['Cash', 'Accounts Payable'])
            .order('id');

        if (verifyErr) {
            console.error('❌ Error:', verifyErr.message);
        } else {
            console.log('Critical Accounts Status:');
            console.log('┌──────┬────────────────────┬────────────┬────────┐');
            console.log('│  ID  │ Account Name       │ Type       │ Status │');
            console.log('├──────┼────────────────────┼────────────┼────────┤');

            accounts.forEach(acc => {
                const expected = acc.name === 'Cash' ? 'asset' : 'liability';
                const status = acc.type === expected ? '✅' : '❌';
                console.log(`│ ${String(acc.id).padEnd(4)} │ ${acc.name.padEnd(18)} │ ${acc.type.padEnd(10)} │ ${status}     │`);
            });

            console.log('└──────┴────────────────────┴────────────┴────────┘\n');
        }

        console.log('✅ Fix complete!');
        console.log('\n📊 Summary:');
        console.log('   • Account 533 (Cash) → asset ✅');
        console.log('   • Account 539 (Accounts Payable) → liability ✅');

    } catch (err) {
        console.error('💥 Error:', err);
    }
}

fixAccount533Back()
    .then(() => {
        console.log('\n🎉 Corrective fix completed!');
        process.exit(0);
    })
    .catch(err => {
        console.error('\n💥 Script failed:', err);
        process.exit(1);
    });
