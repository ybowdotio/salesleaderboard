exports.handler = async () => {
  const clientId = process.env.HUBSPOT_CLIENT_ID;
  const redirectUri = encodeURIComponent(process.env.HUBSPOT_REDIRECT_URI);

  const installUrl = `https://app.hubspot.com/oauth/authorize?client_id=${clientId}&scope=crm.objects.contacts.read crm.objects.owners.read crm.objects.deals.read&redirect_uri=${redirectUri}`;

  return {
    statusCode: 302,
    headers: {
      Location: installUrl,
    },
  };
};
