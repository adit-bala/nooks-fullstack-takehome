describe('Watch Party E2E Test', () => {
  it('should allow creating and joining a session', () => {
    // First client creates a session
    cy.visit('/');
    cy.get('input').first().type('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    cy.get('button').contains('Create a session').click();

    // Get the current URL which contains the session ID
    cy.url().then(url => {
      const sessionId = url.split('/watch/')[1];

      // Open a second browser to simulate a second client
      cy.window().then(win => {
        // Store the session URL for the second client
        const sessionUrl = `${win.location.origin}/watch/${sessionId}`;

        // Visit the session URL in a second browser
        cy.visit(sessionUrl);

        // Verify that the video player is visible
        cy.get('button').contains('Watch Session').should('be.visible');
        cy.get('button').contains('Watch Session').click();

        // Verify that the video player is now playing
        cy.get('[data-testid="react-player"]').should('be.visible');
      });
    });
  });
});
