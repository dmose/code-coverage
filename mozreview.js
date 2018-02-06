/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

let allRevs;
let results = {};

async function waitExists(elemFinder) {
  while (true) {
    let elem = elemFinder();
    if (elem) {
      return elem;
    }

    await(50);
  }
}

async function waitHidden(elem) {
  while (true) {
    let hidden = (elem.style.display === 'none');
    if (hidden) {
      return;
    }

    await wait(50);
  }
}

async function applyOverlay(diff, rev, path) {
  if (!results[path]) {
    results[path] = await fetchCoverage(rev, path);
  }
  let result = results[path];

  let lines = diff.querySelectorAll('td.l');

  for (let line of lines) {
    let line_no_elem = line.parentNode.querySelector('th');
    let line_no = parseInt(line_no_elem.textContent);
    if (isNaN(line_no)) {
      continue;
    }
    if (result.hasOwnProperty(line_no)) {
      if (result[line_no] > 0) {
        line_no_elem.style.backgroundColor = 'greenyellow';
      } else {
        line_no_elem.style.backgroundColor = 'tomato';
      }
    }
  }
}

function removeOverlay(diff) {
  let lines = diff.querySelectorAll('td.l');

  for (let line of lines) {
    let line_no_elem = line.parentNode.querySelector('th');
    line_no_elem.style.backgroundColor = '';
  }
}

async function addButton(diff) {
  if (diff.className != 'diff-container') {
    return;
  }

  const fileName = diff.querySelector('.filename-row').innerText;
  if (fileName.startsWith('commit-message')) {
    return;
  }

  let curRev = allRevs[0]['node'];
  let publicRev = allRevs[allRevs.length - 1]['node'];
  // TODO: If one of the patches in allRevs except allRevs[0] (which is the current patch under review) modifies
  //       this file, then the button should be disabled like when we're not on the latest revision.

  const reviewButton = await waitExists(() => diff.querySelector('.diff-file-btn'));
  const reviewButtonStyle = window.getComputedStyle(reviewButton);
  const reviewButtonPaddingLeft = parseInt(reviewButtonStyle['padding-left'], 10);
  const reviewButtonRight = parseInt(reviewButtonStyle['right'], 10);
  const reviewButtonWidth = reviewButton.offsetWidth;

  const coverageButton = document.createElement('button');
  coverageButton.className = 'diff-file-btn';
  coverageButton.title = coverageButton.textContent = 'Code Coverage ';
  coverageButton.style['right'] = reviewButtonRight + reviewButtonWidth + reviewButtonPaddingLeft + 'px';
  if (!isLatestRevision()) {
    coverageButton.setAttribute('disabled', 'disabled');
    coverageButton.style['cursor'] = 'not-allowed';
    coverageButton.title += '- Only available on the latest revision'
  }
  diff.appendChild(coverageButton);

  const spinner = document.createElement('div');
  spinner.classList.add('gecko_coverage_loader', 'gecko_coverage_loader_dxr');

  let enabled = false;

  async function maybeApply() {
    if (enabled) {
      coverageButton.appendChild(spinner);
      await applyOverlay(diff, publicRev, fileName);
      coverageButton.removeChild(spinner);
      coverageButton.classList.add('reviewed');
    } else {
      removeOverlay(diff);
      coverageButton.classList.remove('reviewed');
    }
  }

  async function toggle() {
    enabled = !enabled;
    maybeApply();
  }

  coverageButton.onclick = toggle;

  /* XXX: Inject this in the page in order to detect when loading happens.
 let oldSetActivityIndicator = RB.setActivityIndicator;
  RB.setActivityIndicator = function(enabled, options) {
    oldSetActivityIndicator(enabled, options);
    maybeApply();
  };*/

  let activityIndicator = document.getElementById('activity-indicator');

  function setExpandHandlers() {
    const elems = diff.querySelectorAll('.diff-expand-btn');
    for (let elem of elems) {
      elem.onclick = async function() {
        await wait(0);

        await waitHidden(activityIndicator);

        maybeApply();
        setExpandHandlers();
      };
    }
  }

  setExpandHandlers();

  return coverageButton;
}

async function getParents(rev) {
  let revisions = [];

  let isPublic = false;

  do {
    let response = await fetch(`https://reviewboard-hg.mozilla.org/gecko/json-rev/${rev}`);
    let data = await response.json();

    isPublic = data['phase'] == 'public';

    // We don't need this for the current shown patch and the mozilla-central patch.
    if (revisions.length != 0 && !isPublic) {
      response = await fetch(`https://reviewboard-hg.mozilla.org/gecko/raw-rev/${rev}`);
      let patch = await response.text();
      // TODO: Add files modified by the patch.
    }
    revisions.push(data);

    rev = data['parents'][0];
  } while (!isPublic);

  return revisions;
}

let buttons = [];
async function injectButtons() {
  while (buttons.length) {
    buttons.pop().remove();
  }

  const diffs = document.getElementById('diffs');
  for (const diff of diffs.children) {
    let button = await addButton(diff);
    if (button) {
      buttons.push(button);
    }
  }
}

function getRevisionLabel() {
  return document.querySelector('#diff_revision_label h1');
}

function isLatestRevision() {
  return getRevisionLabel().textContent.includes('Latest');
}

// XXX: Use https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/webNavigation/onHistoryStateUpdated to detect URL changes instead, it seems less brittle.
function checkRevisionChange(cb) {
  let observer = new MutationObserver(cb);
  observer.observe(getRevisionLabel().parentNode, { childList: true });
}

(async function() {
  const hgurlPattern = new RegExp('https://reviewboard-hg.mozilla.org/gecko/rev/([0-9a-f]+)$');
  let mozreviewRevision = '';
  const reviewRequestInputs = document.getElementById('review-request-inputs');
  for (const reviewRequestInput of reviewRequestInputs.children) {
    const m = reviewRequestInput.value.match(hgurlPattern);
    if (m != null) {
      mozreviewRevision = m[1];
      break;
    }
  }

  allRevs = await getParents(mozreviewRevision);

  if (document.readyState === 'complete') {
    injectButtons();
  } else {
    document.onreadystatechange = function () {
      if (document.readyState !== "complete") {
        return;
      }

      injectButtons();
    };
  }

  checkRevisionChange(injectButtons);
})();