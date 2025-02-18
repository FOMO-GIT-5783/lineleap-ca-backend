db.createUser({
  user: "lineleap_prod_user",
  pwd: "RAAHDExaTDjV48DknRoLohqtuxE8B7jE18zNvX31rxw=",  // Will be used in new connection string
  roles: [
    { role: "readWrite", db: "lineleap_prod" }
  ]
});

// Verify the user was created
db.getUser("lineleap_prod_user"); 