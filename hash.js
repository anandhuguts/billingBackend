// node hash.js
import bcrypt from 'bcrypt';

const plain = 'anandhu'; // change to your chosen initial password
const rounds = 10;

// const run = async () => {
 
// };

// run();

async function running(){
      const h = await bcrypt.hash(plain, rounds);
  console.log(h);
}
running();