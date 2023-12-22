const dotenv = require('dotenv');
const path = require('path');

dotenv.config({
    path: path.resolve(__dirname, `.env.${process.env.NODE_ENV}`)
});

module.exports = {
    NODE_ENV : process.env.NODE_ENV || 'development',
    MYSQL_HOST : process.env.MYSQL_HOST,
    MYSQL_PORT : process.env.MYSQL_PORT,
    MYSQL_USER : process.env.MYSQL_USER,
    MYSQL_PASS : process.env.MYSQL_PASS,
}