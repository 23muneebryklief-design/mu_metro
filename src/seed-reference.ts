import { transaction, type Database } from "./db.js";
import { seed } from "./seed.js";

/** Optional visual-reference catalogue. All cinemas, prices and showtimes are DEMONSTRATION data. */
export async function seedReference(db: Database, now = Date.now()) {
  await seed(db, { now });
  const films = [
    [
      "spider-man",
      "Spider-Man: Brand New Day",
      "Action, Adventure, Sci-fi",
      145,
      "13",
      "7025-1-2-3-1781765591.jpg",
      "A new chapter of the web-slinging adventure. Explore the big-screen experience in this demonstration catalogue.",
    ],
    [
      "paw-patrol",
      "PAW Patrol: The Dino Movie",
      "Animated",
      90,
      "PG",
      "7069-1-1-3-1782137511.jpg",
      "The rescue pups head into a dinosaur-sized adventure. A family movie in our demonstration catalogue.",
    ],
    [
      "resident-evil",
      "Resident Evil",
      "Action, Horror, Sci-fi",
      96,
      "16",
      "7100-1-1-3-1786434892.jpg",
      "A survival horror experience for the big screen. This listing uses sample showtimes for development.",
    ],
    [
      "forgotten-island",
      "Forgotten Island",
      "Animated, Adventure",
      109,
      "PG",
      "7101-1-1-3-1786434144.jpg",
      "An animated journey into an extraordinary world. Discover the movie with demonstration screening times.",
    ],
    [
      "heart-of-the-beast",
      "Heart of the Beast",
      "Action, Adventure, Drama",
      102,
      "13",
      "7102-1-1-3-1788175064.jpg",
      "An adventure of survival and unexpected connections. Shown here as a development catalogue entry.",
    ],
    [
      "shaun-the-sheep",
      "Shaun the Sheep: The Beast of Mossy Bottom",
      "Animated",
      81,
      "PG",
      "7103-1-1-3-1788444253.jpg",
      "Shaun and friends return for another animated adventure. Showtimes on this project are demonstration data.",
    ],
    [
      "wildwood",
      "Wildwood",
      "Animated, Fantasy",
      130,
      "10-12PG",
      "7131-1-1-3-1790606029.jpg",
      "Step into an imaginative woodland adventure. This movie listing is part of the visual-reference demo.",
    ],
    [
      "clayface",
      "Clayface",
      "Horror",
      108,
      "16",
      "7120-1-1-3-1790604629.jpg",
      "A dark big-screen horror experience. Sample screenings are provided for testing the booking flow.",
    ],
    [
      "ramayana",
      "Ramayana: Rise of a Legend (Hindi)",
      "Action, Fantasy",
      196,
      "TBC",
      "7135-1-1-3-1791380267.jpg",
      "An epic fantasy journey on the big screen. This is a demonstration listing, with fictional cinema availability.",
    ],
    [
      "godzilla",
      "Godzilla Minus Zero",
      "Action, Adventure",
      135,
      "TBC",
      "7147-1-3-3-1792060099.jpg",
      "Experience a monster-sized cinema adventure. Availability and prices in this project are examples only.",
    ],
    [
      "dune",
      "Dune: Part Three",
      "Adventure, Sci-fi",
      150,
      "TBC",
      "7096-1-1-3-1784747948.jpg",
      "A future big-screen sci-fi experience. Runtime and release date are placeholders for development.",
    ],
    [
      "ebenezer",
      "Ebenezer: A Christmas Carol",
      "Comedy, Drama, Fantasy",
      120,
      "TBC",
      "7137-1-2-3-1791537900.jpg",
      "A seasonal cinema story to look forward to. Runtime and release date are demonstration values.",
    ],
  ] as const;
  const localDay = new Date(now + 7200000).toISOString().slice(0, 10);
  const today = Date.parse(`${localDay}T00:00:00+02:00`);
  transaction(db, () => {
    const movie = db.prepare(
      "INSERT OR IGNORE INTO movies (id,slug,title,synopsis,duration_minutes,age_rating,genre,poster_url,status,release_date,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    );
    for (const [index, film] of films.entries()) {
      const [slug, title, genre, duration, rating, poster, synopsis] = film;
      movie.run(
        `movie-reference-${slug}`,
        `reference-${slug}`,
        title,
        synopsis,
        duration,
        rating,
        genre,
        `https://numetro.co.za/wp-content/uploads/movies_images/poster/${poster}`,
        index < 10 ? "now_showing" : "coming_soon",
        index < 10
          ? localDay
          : new Date(today + (index + 7) * 86400000).toISOString().slice(0, 10),
        new Date(now).toISOString(),
      );
    }
    const cinemaIds = ["cinema-demo-cape-town", "cinema-demo-johannesburg"];
    const experiences = ["2D", "3D", "Xtreme", "VIP", "4DX"];
    const auditorium = db.prepare(
      "INSERT OR IGNORE INTO auditoriums (id,cinema_id,name,experience) VALUES (?,?,?,?)",
    );
    const seat = db.prepare(
      "INSERT OR IGNORE INTO seats (id,auditorium_id,row_label,number,kind) VALUES (?,?,?,?,?)",
    );
    const screening = db.prepare(
      "INSERT OR IGNORE INTO screenings (id,movie_id,auditorium_id,starts_at,ends_at,price_cents,status) VALUES (?,?,?,?,?,?,?)",
    );
    for (const [cinemaIndex, cinemaId] of cinemaIds.entries())
      for (const [screenIndex, experience] of experiences.entries()) {
        const auditoriumId = `auditorium-reference-${cinemaIndex}-${screenIndex}`;
        auditorium.run(
          auditoriumId,
          cinemaId,
          `Screen ${screenIndex + 2}`,
          experience,
        );
        for (let row = 0; row < 6; row++)
          for (let number = 1; number <= 10; number++) {
            const label = String.fromCharCode(65 + row);
            seat.run(
              `${auditoriumId}-${label}-${number}`,
              auditoriumId,
              label,
              number,
              row === 0 && number === 1
                ? "wheelchair"
                : row === 0 && number === 2
                  ? "companion"
                  : "standard",
            );
          }
        // Date-bearing IDs append a fresh seven-day demo schedule on later runs without moving reservations.
        for (let day = 1; day <= 7; day++)
          for (let slot = 0; slot < 2; slot++) {
            const index = (screenIndex * 2 + slot + day - 1) % 10;
            const film = films[index];
            const starts = today + day * 86400000 + (11 + slot * 7) * 3600000;
            const id = `screening-reference-${cinemaIndex}-${screenIndex}-${datePart(starts)}-${slot}`;
            screening.run(
              id,
              `movie-reference-${film[0]}`,
              auditoriumId,
              new Date(starts).toISOString(),
              new Date(starts + film[3] * 60000).toISOString(),
              9900 + screenIndex * 2500 + cinemaIndex * 1000,
              "scheduled",
            );
          }
      }
  });
  return {
    demo: true,
    referenceMovies: films.length,
    message:
      "Reference artwork; fictional screenings and prices. No real tickets or payments.",
  };
}

function datePart(timestamp: number) {
  return new Date(timestamp + 7200000).toISOString().slice(0, 10);
}
