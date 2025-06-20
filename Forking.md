# Instructions for forking this app for people without Dev Platform experience.

## Prerequsites:

* A computer running Windows, MacOS or Linux
* An editor, such as [Visual Studio Code](https://code.visualstudio.com/download)
* [Git](https://git-scm.com/downloads)
* [Node.js](https://nodejs.org/)

I recommend you also include the VS Code extensions EditorConfig and ESLint, which will ensure consistency of formatting and code quality.

Clone (or fork then clone) the repo, and open a Terminal window in VS Code.

Run `npm i -g devvit` to install Devvit.

Then, run `npm i` to install packages used by the app.

Edit the app's name in devvit.yaml to be a username on Reddit that does not exist yet.

Then, to upload the app do `devvit upload`, then `devvit install <subredditname>`. This will work on small subreddits (e.g. test subreddits) which I would recommend you do before installing on a larger subreddit.

Before installing on a *real* subreddit, you will need to do `devvit publish`. This publishes the app as unlisted, the app will not be listed in the main app directory.
