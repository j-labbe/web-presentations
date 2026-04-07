import argon2 from 'argon2';

const password = process.argv[2];
if (!password) {
    console.error('Usage: npm run genpass -- <password>');
    process.exit(1);
}

console.log(await argon2.hash(password));
