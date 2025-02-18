// Backup configuration for MongoDB Atlas
db.adminCommand({
  createBackupSchedule: 1,
  schedule: [
    {
      frequency: "daily",
      retentionDays: 7,  // Keep daily backups for 7 days
      timeOfDay: "02:00"  // Run at 2 AM UTC
    },
    {
      frequency: "weekly",
      retentionDays: 30,  // Keep weekly backups for 30 days
      dayOfWeek: "Sunday",
      timeOfDay: "03:00"
    },
    {
      frequency: "monthly",
      retentionDays: 90,  // Keep monthly backups for 90 days
      dayOfMonth: 1,
      timeOfDay: "04:00"
    }
  ],
  notifications: {
    success: ["email"],
    failure: ["email", "sms"]
  }
}); 