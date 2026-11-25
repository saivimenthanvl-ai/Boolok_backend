const mongoose = require('mongoose');
const mongoUri = 'mongodb://saivimenthanvl:HMo0DlHx2yyaDGNJ@ac-6qwa5yc-shard-00-00.ip4gjkq.mongodb.net:27017,ac-6qwa5yc-shard-00-01.ip4gjkq.mongodb.net:27017,ac-6qwa5yc-shard-00-02.ip4gjkq.mongodb.net:27017/?ssl=true&replicaSet=atlas-105kui-shard-0&authSource=admin&appName=boolokgpt&compressors=zlib';

async function setupUserD() {
  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;

  // 1. Check or upsert User D (@d)
  let userD = await db.collection('users').findOne({ username: 'd' });
  if (!userD) {
    const insertRes = await db.collection('users').insertOne({
      fullName: 'D',
      username: 'd',
      email: 'd.member@boolok.ai',
      password: '$2a$10$BoolokDefaultPasswordHash2026.SeededUser',
      headline: 'Real Estate Professional & BoolokOne Member',
      location: 'Global Real Estate Network',
      bio: 'Real estate professional and advisor on the Boolok AI network.',
      closedDeals: '0',
      avatarInitial: 'D',
      avatarBgColor: '#FEF08A',
      profilePicture: null,
      coverImage: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200',
      isVerified: true,
      verified: true,
      isDiscoverable: true,
      isArchived: false,
      isTestAccount: false,
      followers: [],
      following: [],
      createdAt: new Date(),
      updatedAt: new Date()
    });
    userD = await db.collection('users').findOne({ _id: insertRes.insertedId });
    console.log('Created user D:', userD._id);
  } else {
    await db.collection('users').updateOne(
      { _id: userD._id },
      {
        $set: {
          fullName: 'D',
          headline: 'Real Estate Professional & BoolokOne Member',
          location: 'Global Real Estate Network',
          avatarInitial: 'D',
          avatarBgColor: '#FEF08A',
          isVerified: true,
          verified: true,
          isDiscoverable: true,
          isArchived: false,
          isTestAccount: false
        }
      }
    );
    console.log('Updated user D:', userD._id);
  }

  // 2. Post 'Land' by user D
  let post = await db.collection('posts').findOne({ author: userD._id, content: 'Land' });
  if (!post) {
    const postRes = await db.collection('posts').insertOne({
      author: userD._id,
      content: 'Land',
      title: 'Land',
      mediaUrl: '/land_post.jpg',
      image: '/land_post.jpg',
      mediaUrls: ['/land_post.jpg'],
      likes: [userD._id],
      comments: [],
      isFeaturedListing: true,
      showOnDashboard: true,
      isProperty: true,
      showInProperties: true,
      isArchived: false,
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    console.log('Created Land post:', postRes.insertedId);
  } else {
    await db.collection('posts').updateOne(
      { _id: post._id },
      {
        $set: {
          mediaUrl: '/land_post.jpg',
          image: '/land_post.jpg',
          mediaUrls: ['/land_post.jpg'],
          likes: [userD._id]
        }
      }
    );
    console.log('Updated Land post');
  }

  // Also ensure Logeshwaran's banner in DB
  await db.collection('users').updateMany(
    { username: { $in: ['waranlogesh0406', 'logeshwarana'] } },
    { $set: { coverImage: '/banners/logeshwaran_banner.png', bannerImage: '/banners/logeshwaran_banner.png' } }
  );
  console.log('Updated Logeshwaran banner in DB');

  // Also ensure Logesh profilePicture in DB
  await db.collection('users').updateMany(
    { username: 'waranalogesh0102' },
    { $set: { profilePicture: '/avatars/logesh_baseball.png', avatar: '/avatars/logesh_baseball.png' } }
  );
  console.log('Updated Logesh avatar in DB');

  await mongoose.disconnect();
}
setupUserD().catch(e => { console.error(e); process.exit(1); });
