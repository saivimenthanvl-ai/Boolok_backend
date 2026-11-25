const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const mongoUri = 'mongodb://saivimenthanvl:HMo0DlHx2yyaDGNJ@ac-6qwa5yc-shard-00-00.ip4gjkq.mongodb.net:27017,ac-6qwa5yc-shard-00-01.ip4gjkq.mongodb.net:27017,ac-6qwa5yc-shard-00-02.ip4gjkq.mongodb.net:27017/?ssl=true&replicaSet=atlas-105kui-shard-0&authSource=admin&appName=boolokgpt&compressors=zlib';

async function updateLandPost() {
  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;

  const userD = await db.collection('users').findOne({ username: 'd' });
  if (!userD) {
    console.error('User D not found');
    await mongoose.disconnect();
    return;
  }

  const imgPath = 'C:\\Users\\saivi\\BoolokGPT\\Boolok_Frontend\\public\\land_post.jpg';
  const buffer = fs.readFileSync(imgPath);
  const base64Data = buffer.toString('base64');
  const dataUri = `data:image/jpeg;base64,${base64Data}`;

  const res = await db.collection('posts').updateMany(
    {
      $or: [
        { author: userD._id },
        { content: 'Land' }
      ]
    },
    {
      $set: {
        author: userD._id,
        content: 'Land',
        title: 'Land',
        mediaUrl: dataUri,
        image: dataUri,
        mediaUrls: [dataUri],
        price: '₹45,00,000',
        location: 'Global Real Estate Network',
        specs: '1,200 sq ft · Prime Open Plot',
        country: 'India',
        currency: 'INR',
        isFeaturedListing: true,
        showOnDashboard: true,
        isProperty: true,
        showInProperties: true,
        isArchived: false,
        isDeleted: false,
      }
    }
  );

  console.log('Updated posts count:', res.modifiedCount);

  // Also check if user D has reels or posts array in User document
  const userPost = await db.collection('posts').findOne({ author: userD._id, content: 'Land' });
  console.log('User D post found:', userPost ? userPost._id : 'none');

  await mongoose.disconnect();
}

updateLandPost().catch(e => { console.error(e); process.exit(1); });
