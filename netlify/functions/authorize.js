exports.handler = async () => {
  const clientId = process.env.HUBSPOT_CLIENT_ID;
  const redirectUri = process.env.HUBSPOT_REDIRECT_URI;
  const scope = 'crm.objects.contacts.read crm.objects.owners.read crm.objects.deals.read';
  
  const url = `https://app.hubspot.com/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=${encodeURIComponent(scope)}&response_type=code`;

  return {
    statusCode: 302,
    headers: {
      Location: url,
    },
  };
};
