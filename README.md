An app to allow timed or comment-cap-only megathreads for /r/ukpolitics.

This app is controlled through a wiki page, `stickymgr/config` on the subreddit that it is installed in.

Multiple megathreads can be configured using YAML on that page. If the post body is updated on the wiki page, the megathread's body is immediately updated.

Example configuration:

```yaml
name: weekly
enabled: true
title: Daily /r/ukpolitics megathread for {{date yyyy-MM-dd}}
frequency: daily
postTime: 02:00
sticky: true
maxComments: 1000
body: |
    This is the megathread for /r/ukpolitics.

    Use this post to discuss all aspects of politics in the UK!
endNote: |
    The megathread has ended. Please see the latest sticky post on the subreddit.
lockOnRefresh: true
```

Omit both `frequency` and `postTime` to keep a megathread open until `maxComments` is reached.

Multiple configurations can be specified, separated by `---`.

Megathreads with `frequency` and `postTime` are replaced once the next post time is reached or the comment limit is reached. If both are omitted, the megathread is replaced only when the comment limit is reached. In both cases, the endNote (if specified) is added as a sticky comment on the post.
