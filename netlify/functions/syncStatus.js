exports.handler = async function () {
  const now = new Date().toISOString();
  return {
    statusCode: 200,
    body: JSON.stringify({ lastSyncedAt: now, status: "OK" }),
  };
};
