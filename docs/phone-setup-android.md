# Setting up BAUD on an Android phone

Your phone reaches BAUD over your own Tailscale network, so the phone and the machine need to be on the same tailnet. This takes about five minutes. You need the installer's last lines from the machine, so keep that terminal open.

## Steps

1. On the phone, open the Play Store, search for **Tailscale**, and install it.
   <!-- screenshot: Play Store page for Tailscale, Install button -->
2. Open Tailscale and sign in with the **same account** you used on the machine (`tailscale up` printed that sign-in link).
   <!-- screenshot: Tailscale sign-in choice on Android -->
3. Allow the VPN request Android shows. Tailscale uses Android's VPN slot to reach your tailnet.
   <!-- screenshot: Android "Connection request" VPN dialog -->
4. Check that Tailscale says **Connected** and that your machine is in its list of devices.
   <!-- screenshot: Tailscale on Android, Connected, the machine listed -->
5. On the machine, the installer's last lines show the phone address (it starts with `http://100.`) and the command that mints your phone's token. Run that command there.
   <!-- screenshot: the terminal's closing lines, address and token command, token value never shown -->
6. Get the token from the receipt file the command names onto the phone, using the way the installer's last lines describe. Treat it like a password: never paste it into a chat or an email.
   <!-- screenshot: none (the token is a secret) -->
7. On the phone, open **Chrome** and type the address from step 5 exactly, including `http://` and the port.
   <!-- screenshot: Chrome address bar with the tailnet address -->
8. The BAUD sign-in page opens. Paste the token and tap **sign in**.
   <!-- screenshot: BAUD sign-in page, token field, sign in button -->
9. The wheel appears with your agents on it. You are in.
   <!-- screenshot: the wheel after first sign-in -->
10. In Chrome's ⋮ menu, tap **Add to Home screen**, so BAUD opens from an icon like an app.
    <!-- screenshot: Chrome menu, Add to Home screen -->

## When the page does not load

- **Tailscale is off on one side.** The phone's Tailscale must say Connected. On the machine, `tailscale status` must list the phone. Turn on whichever side is off, then reload.
- **The machine's API is not running.** The face is served by AIPass's host API on the machine. If the machine restarted, start the API again the way the installer's last lines describe, then reload.
- **The address is wrong.** It must be the machine's tailnet address (`100.x.y.z`) with the port, starting with `http://`, not `https://`. Copy it from the installer's output or from `tailscale ip -4` on the machine.
- **The sign-in page says the token is refused.** The token may have been revoked or mistyped. Mint a new one on the machine and paste it again.
- **The phone was lost.** On the machine, `drone @api host-api list-tokens` shows each token, and `drone @api host-api revoke-token <id>` cuts the lost phone off at once.
