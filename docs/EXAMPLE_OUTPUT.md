# Example: Running a Generated Start Script

After creating a start script with `./create-start-script.sh`, you can run it with a simple command.

## Command

```bash
start-aws-dev-server
```

## Output

```
╔═══════════════════════════════════════════╗
║   Starting AWS EC2: dev-server           ║
╚═══════════════════════════════════════════╝

Region: us-east-1
Instance: i-0a1b2c3d4e5f6g7h8

🚀 Starting instance...
⏳ Waiting for instance to be running...
⏳ Waiting for status checks to pass...

✅ Instance is UP!
   IP Address: 54.123.45.67

✓ SSH config updated

╔═══════════════════════════════════════════╗
║   Ready to connect!                      ║
╚═══════════════════════════════════════════╝

Connect with: ssh dev-server
Or use your VS Code Remote-SSH extension
```

## Desktop Notification

If `notify-send` is available (on most Linux desktops), you'll also see system notifications:

1. **Starting**: "Waking up dev-server..." (low priority, 3 seconds)
2. **Ready**: "dev-server is UP at 54.123.45.67" (normal priority, 5 seconds)

## SSH Connection

After the script completes, connect immediately:

```bash
ssh dev-server
```

Or open VS Code Remote-SSH and your host will have the updated IP address.

## What Happens Behind the Scenes

1. **Start Command**: `aws ec2 start-instances --region us-east-1 --instance-ids i-xxxxx`
2. **Wait for Running**: Polls until instance state is "running"
3. **Wait for Status OK**: Polls until both system and instance status checks pass
4. **Get IP**: Queries for the current PublicIpAddress
5. **Update SSH Config**: Uses `sed` to replace the HostName line between markers
6. **Notify**: Sends desktop notification via `notify-send`

## Typical Timeline

- **Already running**: ~5 seconds (just status checks)
- **Starting from stopped**: ~45-90 seconds (includes boot time)
- **Starting from hibernated**: ~30-60 seconds (depends on memory size)

## Error Handling

If something goes wrong, you'll see clear error messages:

```
🚀 Starting instance...
Failed to start instance. Check your AWS credentials and instance ID.
```

Common issues:
- Instance is terminating/terminated
- Insufficient IAM permissions
- Wrong region configuration
- Instance is already running (this is actually fine - script continues)
