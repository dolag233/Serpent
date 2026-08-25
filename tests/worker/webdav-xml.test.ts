import { describe, expect, it } from 'vitest';

import { parseWebDAVMultistatus } from '../../src/worker/sync/webdav-xml';

describe('WebDAV multistatus parsing (Serpent-xffq)', () => {
  it('detects collections whose resourcetype carries an xmlns attribute (real-server shape)', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/Share/Serpent/test-library/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection xmlns:D="DAV:"/></D:resourcetype>
        <D:getlastmodified>Sun, 16 Aug 2026 06:08:30 GMT</D:getlastmodified>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>/Share/Serpent/a.txt</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype></D:resourcetype>
        <D:getcontentlength>42</D:getcontentlength>
        <D:getetag>"abc"</D:getetag>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
    const entries = parseWebDAVMultistatus(xml);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.href).toBe('/Share/Serpent/test-library/');
    expect(entries[0]!.props.isCollection).toBe(true);
    expect(entries[1]!.href).toBe('/Share/Serpent/a.txt');
    expect(entries[1]!.props.isCollection).toBe(false);
  });

  it('handles arbitrary namespace prefixes and prefix-less tags', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<ns0:multistatus xmlns:ns0="DAV:">
  <ns0:response>
    <ns0:href>lib/</ns0:href>
    <ns0:propstat>
      <ns0:prop>
        <ns0:resourcetype><ns0:collection/></ns0:resourcetype>
        <ns0:getetag>"e1"</ns0:getetag>
      </ns0:prop>
      <ns0:status>HTTP/1.1 200 OK</ns0:status>
    </ns0:propstat>
  </ns0:response>
  <response>
    <href>file.bin</href>
    <propstat>
      <prop>
        <resourcetype/>
        <getcontentlength>7</getcontentlength>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</ns0:multistatus>`;
    const entries = parseWebDAVMultistatus(xml);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.props.isCollection).toBe(true);
    expect(entries[1]!.props.isCollection).toBe(false);
    expect(entries[1]!.props.contentLength).toBe(7);
  });

  it('picks the first 2xx propstat even when an earlier propstat is 404', () => {
    const xml = `<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/dav/x.txt</D:href>
    <D:propstat>
      <D:prop><D:getcontentlength>404</D:getcontentlength></D:prop>
      <D:status>HTTP/1.1 404 Not Found</D:status>
    </D:propstat>
    <D:propstat>
      <D:prop><D:getcontentlength>123</D:getcontentlength><D:getetag>"abc"</D:getetag></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
    const entries = parseWebDAVMultistatus(xml);
    expect(entries[0]!.props.contentLength).toBe(123);
    expect(entries[0]!.props.etag).toBe('"abc"');
  });

  it('treats a missing or empty resourcetype as a non-collection', () => {
    const xml = `<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/dav/x/</D:href>
    <D:propstat>
      <D:prop><D:resourcetype></D:resourcetype></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
    expect(parseWebDAVMultistatus(xml)[0]!.props.isCollection).toBe(false);
  });

  it('accepts a non-self-closing collection tag', () => {
    const xml = `<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/dav/x/</D:href>
    <D:propstat>
      <D:prop><D:resourcetype><D:collection></D:collection></D:resourcetype></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
    expect(parseWebDAVMultistatus(xml)[0]!.props.isCollection).toBe(true);
  });
});
