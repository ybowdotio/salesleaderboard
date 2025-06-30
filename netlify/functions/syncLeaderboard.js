exports.handler = async () => {
  console.log("🧪 Test: Function is running");
  return {
    statusCode: 200,
    body: JSON.stringify({ message: "Test OK" }),
  };
};
