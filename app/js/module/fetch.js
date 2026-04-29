export default async function executeRequest(url) {
  return fetch(url, {
    method: 'GET',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Accept: 'text/plain, */*',
    },
  })
}

export function isHtmlContentType(response) {
  const contentType = response.headers.get('content-type')
  return contentType && contentType.indexOf('html') > -1
}
