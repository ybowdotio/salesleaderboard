// netlify/functions/authStart.js
exports.handler = async () => {
  const CLIENT_ID = process.env.HUBSPOT_CLIENT_ID;
  const REDIRECT_URI = encodeURIComponent('https://salesleaderboard.netlify.app/.netlify/functions/authCallback');
  const SCOPES = encodeURIComponent('crm.objects.contacts.read crm.objects.owners.read crm.objects.deals.read');

  const url = `https://app.hubspot.com/oauth/authorize?client_id=${CLIENT_ID}&scope=${SCOPES}&redirect_uri=${REDIRECT_URI}`;

  return {
    statusCode: 302,
    headers: {
      Location: url,
    },
  };
};
